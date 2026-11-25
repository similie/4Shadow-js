import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { createProgram, screenQuad, type Program } from "./gl";
import type { SeaMask } from "./sea-mask";

const VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// The line covers the land within u_width pixels of the water: the most water found on two rings
// around the pixel (the inner one catches narrow straits), less the water under the pixel itself.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_sea;
uniform vec2 u_px;
uniform float u_width;
uniform vec4 u_color;
in vec2 v_uv;
out vec4 fragColor;
const int DIRECTIONS = 8;
void main() {
  float here = texture(u_sea, v_uv).a;
  if (here > 0.99) discard;
  float near = 0.0;
  for (int i = 0; i < DIRECTIONS; i++) {
    float a = 6.2831853 * float(i) / float(DIRECTIONS);
    vec2 d = vec2(cos(a), sin(a)) * u_px * u_width;
    near = max(near, max(texture(u_sea, v_uv + d).a, texture(u_sea, v_uv + 0.5 * d).a));
  }
  float line = smoothstep(0.15, 0.85, near) * (1.0 - here);
  if (line < 0.004) discard;
  fragColor = u_color * line;
}`;

/** Line width in CSS pixels: finer when zoomed out, where coasts crowd together. */
function lineWidth(zoom: number): number {
  return 1.1 + 0.5 * Math.min(1, Math.max(0, (zoom - 2) / 4));
}

/**
 * Coastlines over the weather: a line along the land side of the basemap's water, traced each
 * frame from the SeaMask, so it matches the basemap's coast at every zoom and needs no data of its
 * own (OpenStreetMap's sea polygons are cut into squares, so outlining them would draw a grid).
 *
 * Add it above the weather. It only lights pixels of the world's surface (they are opaque by then),
 * so the edge of a globe, where sea meets space, gets no line.
 */
export class CoastLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  private readonly seaMask: SeaMask;
  private map: MapLibreMap | null = null;
  private program: Program | null = null;
  private quad: WebGLVertexArrayObject | null = null;
  private visible = true;
  /** Premultiplied RGBA. */
  private color: [number, number, number, number] = [1, 1, 1, 1];

  constructor(seaMask: SeaMask, id = "weather-coast") {
    this.id = id;
    this.seaMask = seaMask;
    seaMask.use(id, true);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.seaMask.use(this.id, on);
    this.map?.triggerRepaint();
  }

  /** RGB (0 to 1) and opacity. */
  setColor([r, g, b, a]: [number, number, number, number]): void {
    this.color = [r * a, g * a, b * a, a];
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.program = createProgram(gl, VERTEX, FRAGMENT);
    this.quad = screenQuad(gl);
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program.program);
    if (this.quad) gl.deleteVertexArray(this.quad);
    this.program = null;
    this.quad = null;
    this.map = null;
  }

  render(gl: WebGL2RenderingContext): void {
    const { map, program } = this;
    if (!this.visible || !map || !program) return;
    const sea = this.seaMask.current();
    if (!sea) {
      // Just turned on: the water is copied from the next frame.
      map.triggerRepaint();
      return;
    }
    gl.useProgram(program.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sea);
    gl.uniform1i(program.uniform("u_sea"), 0);
    gl.uniform2f(program.uniform("u_px"), 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1f(program.uniform("u_width"), lineWidth(map.getZoom()) * map.getPixelRatio());
    gl.uniform4fv(program.uniform("u_color"), this.color);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    // Weighted by what is already there: the world's surface is opaque by now, space is not.
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
