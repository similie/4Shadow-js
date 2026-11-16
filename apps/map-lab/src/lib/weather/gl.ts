import type { Field, FieldGrid } from "@similie/4shadow";
import type { CustomRenderMethodInput } from "maplibre-gl";

/** Stored in textures where the API had no value (NaN does not survive every GPU driver). */
export const MISSING = -1e30;

export interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const numbered = source
      .split("\n")
      .map((l, i) => `${String(i + 1).padStart(3)} ${l}`)
      .join("\n");
    throw new Error(`Shader compile failed: ${log}\n${numbered}`);
  }
  return shader;
}

/** Compile and link a program. `feedback` names transform-feedback outputs (interleaved). */
export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, feedback?: string[]): Program {
  const program = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  if (feedback) gl.transformFeedbackVaryings(program, feedback, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    },
  };
}

/**
 * A vertex shader that places mercator coordinates (0..1) on the map in either projection.
 * MapLibre supplies `projectTile()` for the current projection (mercator or globe).
 */
export function projectedVertexShader(args: CustomRenderMethodInput, body: string): string {
  return `#version 300 es
${args.shaderData.define}
${args.shaderData.vertexShaderPrelude}
${body}`;
}

/** Set the projection uniforms MapLibre's prelude declares. */
export function setProjectionUniforms(gl: WebGL2RenderingContext, p: Program, args: CustomRenderMethodInput): void {
  const d = args.defaultProjectionData;
  gl.uniformMatrix4fv(p.uniform("u_projection_matrix"), false, d.mainMatrix as Float32Array);
  gl.uniformMatrix4fv(p.uniform("u_projection_fallback_matrix"), false, d.fallbackMatrix as Float32Array);
  gl.uniform4f(p.uniform("u_projection_tile_mercator_coords"), ...d.tileMercatorCoords);
  gl.uniform4f(p.uniform("u_projection_clipping_plane"), ...d.clippingPlane);
  gl.uniform1f(p.uniform("u_projection_transition"), d.projectionTransition);
}

/** True when MapLibre is drawing a globe (or turning into one). */
export function isGlobe(args: CustomRenderMethodInput): boolean {
  return args.shaderData.variantName !== "mercator";
}

/**
 * GLSL to read a field texture at a longitude/latitude: bilinear over the four grid points,
 * skipping missing ones, wrapping east-west on global grids. A `Grid` describes one texture's
 * grid, so a shader can read several (a global field and a regional detail one).
 * `fieldValue(tex, grid, lon, lat)` returns MISSING outside the grid.
 */
export const SAMPLE_GLSL = `
const float MISSING = -1e30;
const float MISSING_TEST = -1e29;
struct Grid {
  vec4 geo;    // lat0, dlat, lon0, dlon
  ivec2 size;  // nlon, nlat
  int wraps;
};
uniform int u_magnitude; // 1: the texture holds a vector (rg); return its length

float texel(sampler2D tex, int i, int j) {
  vec4 s = texelFetch(tex, ivec2(j, i), 0);
  if (s.r < MISSING_TEST) return MISSING;
  return u_magnitude == 1 ? length(s.rg) : s.r;
}

// Fractional grid position (column, row) of lon/lat; x < -0.5 means outside.
vec2 gridPos(Grid g, float lon, float lat) {
  float fi = (g.geo.x - lat) / g.geo.y;
  float fj = mod(lon - g.geo.z, 360.0) / g.geo.w;
  if (fi < 0.0 || fi > float(g.size.y - 1)) return vec2(-1.0);
  if (g.wraps == 0 && fj > float(g.size.x - 1)) return vec2(-1.0);
  return vec2(fj, fi);
}

// The four grid points around a grid position (rows i0, i0 + 1; columns j.x, j.y) and the weights.
void corners(Grid g, vec2 p, out int i0, out ivec2 j, out vec2 w) {
  int nlon = g.size.x;
  i0 = min(int(floor(p.y)), g.size.y - 2);
  int j0 = int(floor(p.x));
  w = vec2(p.x - float(j0), p.y - float(i0));
  int j1 = j0 + 1;
  if (g.wraps == 1) { j0 = j0 % nlon; j1 = j1 % nlon; } else { j1 = min(j1, nlon - 1); }
  j = ivec2(j0, j1);
}

float fieldValue(sampler2D tex, Grid g, float lon, float lat) {
  vec2 p = gridPos(g, lon, lat);
  if (p.x < -0.5) return MISSING;
  int i0; ivec2 j; vec2 w;
  corners(g, p, i0, j, w);
  float v[4] = float[4](texel(tex, i0, j.x), texel(tex, i0, j.y), texel(tex, i0 + 1, j.x), texel(tex, i0 + 1, j.y));
  float k[4] = float[4]((1.0 - w.y) * (1.0 - w.x), (1.0 - w.y) * w.x, w.y * (1.0 - w.x), w.y * w.x);
  float num = 0.0;
  float den = 0.0;
  for (int n = 0; n < 4; n++) {
    if (v[n] > MISSING_TEST) { num += v[n] * k[n]; den += k[n]; }
  }
  return den > 0.0 ? num / den : MISSING;
}

// Bilinear vector (u, v) from an rg texture, in xy; z is 0 when any of the four points is missing
// (waves over land), else 1.
vec3 fieldVector(sampler2D tex, Grid g, float lon, float lat) {
  vec2 p = gridPos(g, lon, lat);
  if (p.x < -0.5) return vec3(0.0);
  int i0; ivec2 j; vec2 w;
  corners(g, p, i0, j, w);
  vec4 a = texelFetch(tex, ivec2(j.x, i0), 0);
  vec4 b = texelFetch(tex, ivec2(j.y, i0), 0);
  vec4 c = texelFetch(tex, ivec2(j.x, i0 + 1), 0);
  vec4 d = texelFetch(tex, ivec2(j.y, i0 + 1), 0);
  if (min(min(a.r, b.r), min(c.r, d.r)) < MISSING_TEST) return vec3(0.0);
  return vec3(mix(mix(a.rg, b.rg, w.x), mix(c.rg, d.rg, w.x), w.y), 1.0);
}

const float PI_ = 3.141592653589793;

// Mercator (0..1) to degrees.
vec2 mercatorToLonLat(vec2 m) {
  float lon = m.x * 360.0 - 180.0;
  float lat = degrees(atan(sinh(PI_ * (1.0 - 2.0 * m.y))));
  return vec2(lon, lat);
}
`;

/** Set a `Grid` uniform (declared in SAMPLE_GLSL) to a field's grid. */
export function setGridUniforms(gl: WebGL2RenderingContext, p: Program, grid: FieldGrid, name = "u_grid"): void {
  gl.uniform4f(p.uniform(`${name}.geo`), grid.lat0, grid.dlat, grid.lon0, grid.dlon);
  gl.uniform2i(p.uniform(`${name}.size`), grid.nlon, grid.nlat);
  gl.uniform1i(p.uniform(`${name}.wraps`), grid.wraps ? 1 : 0);
}

/**
 * GPU textures for fields, keyed by the Field object and its variables. Float textures are read
 * with texelFetch (no filtering needed, so no float-linear extension needed).
 */
export class FieldTextures {
  private readonly gl: WebGL2RenderingContext;
  private readonly cache = new Map<string, { field: Field; texture: WebGLTexture }>();
  private readonly ids = new WeakMap<Field, number>();
  private nextId = 1;
  private readonly limit: number;

  constructor(gl: WebGL2RenderingContext, limit = 8) {
    this.gl = gl;
    this.limit = limit;
  }

  private key(field: Field, vars: string[]): string {
    let id = this.ids.get(field);
    if (!id) {
      id = this.nextId++;
      this.ids.set(field, id);
    }
    return `${id}:${vars.join(",")}`;
  }

  /**
   * A texture of one variable (R32F) or of two as a vector (RG32F: u in r, v in g).
   * `spread` fills missing cells next to data with their neighbours' mean, that many cells deep:
   * sea-only fields then reach the real coastline, which is finer than the model's land mask.
   */
  get(field: Field, vars: [string] | [string, string], spread = 0): WebGLTexture {
    const key = `${this.key(field, vars)}/${spread}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.texture;
    }
    const gl = this.gl;
    const { nlon, nlat } = field.grid;
    // Uploading needs a binding; put back whatever the active unit had, so a caller that is
    // part-way through binding its samplers doesn't lose one (that showed as a one-frame flash).
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (vars.length === 1) {
      const src = field.values(vars[0]);
      const data = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) data[i] = Number.isNaN(src[i]!) ? MISSING : src[i]!;
      if (spread) spreadIntoGaps(data, 1, nlon, nlat, field.grid.wraps, spread);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nlon, nlat, 0, gl.RED, gl.FLOAT, data);
    } else {
      const u = field.values(vars[0]);
      const v = field.values(vars[1]);
      const data = new Float32Array(u.length * 2);
      for (let i = 0; i < u.length; i++) {
        const bad = Number.isNaN(u[i]!) || Number.isNaN(v[i]!);
        data[2 * i] = bad ? MISSING : u[i]!;
        data[2 * i + 1] = bad ? 0 : v[i]!;
      }
      if (spread) spreadIntoGaps(data, 2, nlon, nlat, field.grid.wraps, spread);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, nlon, nlat, 0, gl.RG, gl.FLOAT, data);
    }
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, bound);
    this.cache.set(key, { field, texture });
    while (this.cache.size > this.limit) {
      const [oldest, entry] = this.cache.entries().next().value!;
      gl.deleteTexture(entry.texture);
      this.cache.delete(oldest);
    }
    return texture;
  }

  dispose(): void {
    for (const { texture } of this.cache.values()) this.gl.deleteTexture(texture);
    this.cache.clear();
  }
}

/**
 * Fill MISSING cells that touch data with the mean of their valid neighbours (8-connected),
 * `passes` times, in place. `channels` values per cell; the first one marks missing.
 */
export function spreadIntoGaps(data: Float32Array, channels: 1 | 2, nlon: number, nlat: number, wraps: boolean, passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    const fills: Array<[number, number, number]> = [];
    for (let i = 0; i < nlat; i++) {
      for (let j = 0; j < nlon; j++) {
        const at = (i * nlon + j) * channels;
        if (data[at]! > MISSING / 10) continue;
        let n = 0;
        let a = 0;
        let b = 0;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nlat) continue;
          for (let dj = -1; dj <= 1; dj++) {
            let jj = j + dj;
            if (jj < 0 || jj >= nlon) {
              if (!wraps) continue;
              jj = (jj + nlon) % nlon;
            }
            const k = (ii * nlon + jj) * channels;
            if (data[k]! > MISSING / 10) {
              n++;
              a += data[k]!;
              if (channels === 2) b += data[k + 1]!;
            }
          }
        }
        if (n) fills.push([at, a / n, b / n]);
      }
    }
    if (!fills.length) return;
    for (const [at, a, b] of fills) {
      data[at] = a;
      if (channels === 2) data[at + 1] = b;
    }
  }
}

/** A buffer of the four corners of the screen, for full-screen passes (two triangles as a strip). */
export function screenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}

/** Mercator x/y (0..1 within ±85.05°) of a longitude/latitude, latitude limited to ±maxLat. */
export function toMercator(lon: number, lat: number, maxLat = 85.051129): [number, number] {
  const clamped = Math.max(-maxLat, Math.min(maxLat, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}
