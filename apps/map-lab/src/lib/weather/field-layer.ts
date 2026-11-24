import type { Field, Legend } from "@similie/4shadow";
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import {
  createProgram,
  FieldTextures,
  isGlobe,
  projectedVertexShader,
  SAMPLE_GLSL,
  setGridUniforms,
  setProjectionUniforms,
  type Program,
} from "./gl";

const MAX_STOPS = 16;

/** Two forecast steps of one variable and how far between them to draw (0 = a, 1 = b). */
export interface FieldFrames {
  a: Field;
  b: Field | null;
  t: number;
}

export interface ColorSpec {
  /** One stored variable, or u/v components drawn as their magnitude (wind speed). */
  vars: [string] | [string, string];
  legend: Legend;
  /** Sea only (waves): drawn only where the basemap drew water, reaching its coastline. */
  marine?: boolean;
  /** Land only (fire weather): drawn only where the basemap drew no water, reaching its coastline. */
  landOnly?: boolean;
}

/**
 * How many grid cells sea-only or land-only data is spread across the model's coastline, which is
 * coarser than the basemap's; the basemap's own coastline then clips it. Wave particles use it too.
 */
export const COAST_SPREAD = 2;

const VERTEX = `
layout(location = 0) in vec2 a_lonlat;
uniform float u_wrap;
uniform float u_max_lat;
out vec2 v_merc;
void main() {
  float lat = clamp(a_lonlat.y, -u_max_lat, u_max_lat);
  float s = sin(radians(lat));
  vec2 merc = vec2((a_lonlat.x + 180.0) / 360.0 + u_wrap, 0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * PI));
  v_merc = merc;
  gl_Position = projectTile(merc);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${SAMPLE_GLSL}
uniform Grid u_grid;    // the global field
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform Grid u_detail;  // a finer field of the area in view, used where it covers
uniform sampler2D u_da;
uniform sampler2D u_db;
uniform int u_has_detail;
uniform float u_t;
uniform int u_has_b;
uniform float u_stops[${MAX_STOPS}];
uniform vec4 u_colors[${MAX_STOPS}];
uniform int u_nstops;
uniform vec2 u_visible;  // values outside [x, y] are transparent
uniform float u_opacity;
uniform vec4 u_fill;     // with u_fill_only: paint this colour (the land) instead
uniform int u_fill_only;
in vec2 v_merc;
out vec4 fragColor;

vec4 colorOf(float v) {
  if (v < u_visible.x || v > u_visible.y) return vec4(0.0);
  if (v <= u_stops[0]) return u_colors[0];
  for (int k = 1; k < ${MAX_STOPS}; k++) {
    if (k >= u_nstops) break;
    if (v <= u_stops[k]) {
      float t = (v - u_stops[k - 1]) / (u_stops[k] - u_stops[k - 1]);
      return mix(u_colors[k - 1], u_colors[k], t);
    }
  }
  return u_colors[u_nstops - 1];
}

// The value between two steps (a missing step falls back to the other).
float between(sampler2D ta, sampler2D tb, Grid g, vec2 ll) {
  float a = fieldValue(ta, g, ll.x, ll.y);
  if (u_has_b == 0) return a;
  float b = fieldValue(tb, g, ll.x, ll.y);
  if (a < MISSING_TEST) return b;
  return b > MISSING_TEST ? mix(a, b, u_t) : a;
}

void main() {
  if (u_fill_only == 1) {
    fragColor = u_fill;
    return;
  }
  vec2 ll = mercatorToLonLat(vec2(fract(v_merc.x), v_merc.y));
  bool detail = u_has_detail == 1 && gridPos(u_detail, ll.x, ll.y).x > -0.5;
  float v = detail ? between(u_da, u_db, u_detail, ll) : between(u_a, u_b, u_grid, ll);
  if (v < MISSING_TEST) discard;
  vec4 c = colorOf(v);
  fragColor = vec4(c.rgb * c.a, c.a) * u_opacity;
}`;

function parseColor(hex: string): [number, number, number, number] {
  const h = hex.replace(/^#/, "");
  const full = h.length === 6 ? h + "ff" : h;
  return [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number, number];
}

/**
 * A MapLibre custom layer that colours a forecast field on the GPU, from the API's raw values
 * (`/v2/{model}/fields`) and its legend: the same colours as the server's PNG tiles, but smooth
 * between grid points, interpolated in time between steps, in mercator or on a globe.
 */
export class FieldLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  private map: MapLibreMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private programs = new Map<string, Program>();
  private textures: FieldTextures | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vertexCount = 0;
  private frames: FieldFrames | null = null;
  private detail: FieldFrames | null = null;
  private spec: ColorSpec | null = null;
  private stops = new Float32Array(MAX_STOPS);
  private colors = new Float32Array(MAX_STOPS * 4);
  private nstops = 0;
  private visible: [number, number] = [-Infinity, Infinity];
  private land: [number, number, number, number];
  opacity = 0.85;

  /** `land`: the colour painted under everything not yet opaque (the basemap has no background). */
  constructor(id = "weather-field", land = "#262b33") {
    this.id = id;
    this.land = parseColor(land);
  }

  /** The colour painted under the weather (the theme's land). */
  setLand(land: string): void {
    this.land = parseColor(land);
    this.map?.triggerRepaint();
  }

  /** What to draw: the variable(s) and its colour legend. */
  setSpec(spec: ColorSpec | null): void {
    this.spec = spec;
    if (spec) {
      const stops = spec.legend.stops.slice(0, MAX_STOPS);
      this.nstops = stops.length;
      this.stops.fill(0);
      this.colors.fill(0);
      stops.forEach((s, i) => {
        this.stops[i] = s.value;
        this.colors.set(parseColor(s.color), i * 4);
      });
      const below = spec.legend.transparent_below;
      const above = spec.legend.transparent_above;
      this.visible = [below ?? -3.4e38, above ?? 3.4e38];
    }
    this.map?.triggerRepaint();
  }

  /**
   * The steps to draw; call again as time moves (cheap: textures are cached per field).
   * `detail` is the same steps at a finer grid for part of the world (a `bbox` field), drawn where
   * it covers; it must be for the same steps and `t` as `frames`.
   */
  setFrames(frames: FieldFrames | null, detail: FieldFrames | null = null): void {
    this.frames = frames;
    this.detail = frames ? detail : null;
    this.map?.triggerRepaint();
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;
    this.textures = new FieldTextures(gl, 10);
    // A lon/lat mesh, 2° x 1°: fine enough to curve with the globe; mercator is exact per pixel anyway.
    const lons = 181;
    const lats = 181;
    const verts: number[] = [];
    const at = (i: number, j: number) => [-180 + (360 * j) / (lons - 1), 90 - (180 * i) / (lats - 1)];
    for (let i = 0; i < lats - 1; i++) {
      for (let j = 0; j < lons - 1; j++) {
        const p00 = at(i, j),
          p01 = at(i, j + 1),
          p10 = at(i + 1, j),
          p11 = at(i + 1, j + 1);
        verts.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
      }
    }
    this.vertexCount = verts.length / 2;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.textures?.dispose();
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
    this.programs.clear();
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.map = null;
    this.gl = null;
  }

  private program(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): Program {
    const name = args.shaderData.variantName;
    let p = this.programs.get(name);
    if (!p) {
      p = createProgram(gl, projectedVertexShader(args, VERTEX), FRAGMENT);
      this.programs.set(name, p);
    }
    return p;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const { frames, detail, spec, map, textures } = this;
    if (!map || !textures) return;
    const p = this.program(gl, args);
    gl.useProgram(p.program);
    setProjectionUniforms(gl, p, args);
    const globe = isGlobe(args);
    gl.uniform1f(p.uniform("u_max_lat"), globe ? 89.95 : 85.0511);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    const wraps = globe ? [0] : visibleWraps(map);
    const drawMesh = () => {
      gl.bindVertexArray(this.vao);
      for (const wrap of wraps) {
        gl.uniform1f(p.uniform("u_wrap"), wrap);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      }
      gl.bindVertexArray(null);
    };
    if (frames && spec && this.opacity > 0) this.drawField(gl, p, frames, detail, spec, textures, drawMesh);

    // Land: the colour goes under whatever isn't opaque yet ("under" blending), over the world's
    // surface only, so on a globe the space around it stays dark.
    gl.uniform1i(p.uniform("u_fill_only"), 1);
    const [r, g, b, a] = this.land;
    gl.uniform4f(p.uniform("u_fill"), r * a, g * a, b * a, a);
    gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    drawMesh();
    gl.uniform1i(p.uniform("u_fill_only"), 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawField(
    gl: WebGL2RenderingContext,
    p: Program,
    frames: FieldFrames,
    detail: FieldFrames | null,
    spec: ColorSpec,
    textures: FieldTextures,
    drawMesh: () => void,
  ): void {
    const bind = (unit: number, name: string, texture: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(p.uniform(name), unit);
    };
    // Get (and on a new step, upload) every texture before binding any.
    const spread = spec.marine || spec.landOnly ? COAST_SPREAD : 0;
    const texA = textures.get(frames.a, spec.vars, spread);
    const texB = frames.b ? textures.get(frames.b, spec.vars, spread) : texA;
    const texDa = detail ? textures.get(detail.a, spec.vars, spread) : texA; // unused without detail,
    const texDb = detail?.b ? textures.get(detail.b, spec.vars, spread) : texDa; // but samplers need a texture

    gl.uniform1i(p.uniform("u_magnitude"), spec.vars.length === 2 ? 1 : 0);
    setGridUniforms(gl, p, frames.a.grid, "u_grid");
    if (detail) setGridUniforms(gl, p, detail.a.grid, "u_detail");
    bind(0, "u_a", texA);
    bind(1, "u_b", texB);
    bind(2, "u_da", texDa);
    bind(3, "u_db", texDb);
    gl.uniform1i(p.uniform("u_has_b"), frames.b ? 1 : 0);
    gl.uniform1i(p.uniform("u_has_detail"), detail ? 1 : 0);
    gl.uniform1f(p.uniform("u_t"), frames.t);
    gl.uniform1fv(p.uniform("u_stops"), this.stops);
    gl.uniform4fv(p.uniform("u_colors"), this.colors);
    gl.uniform1i(p.uniform("u_nstops"), this.nstops);
    gl.uniform2f(p.uniform("u_visible"), this.visible[0], this.visible[1]);
    gl.uniform1f(p.uniform("u_opacity"), this.opacity);
    gl.uniform1i(p.uniform("u_fill_only"), 0);

    if (spec.marine) {
      // Only where something opaque is already drawn, which at this point is only water (the
      // background is transparent); and leave the alpha as it is, so the land fill still finds land.
      gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    } else if (spec.landOnly) {
      // Only where nothing is drawn yet, which is land (water is opaque): "under" blending, as the land fill.
      gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    drawMesh();
  }
}

/** The world copies (…, -1, 0, 1, …) a flat map currently shows. */
export function visibleWraps(map: MapLibreMap): number[] {
  const b = map.getBounds();
  const first = Math.floor((b.getWest() + 180) / 360);
  const last = Math.floor((b.getEast() + 180) / 360);
  const out: number[] = [];
  for (let w = Math.max(first, -3); w <= Math.min(last, 3); w++) out.push(w);
  return out;
}
