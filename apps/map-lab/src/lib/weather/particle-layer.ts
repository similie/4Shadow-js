import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import type { FieldFrames } from "./field-layer";
import {
  createProgram,
  FieldTextures,
  isGlobe,
  projectedVertexShader,
  SAMPLE_GLSL,
  screenQuad,
  setGridUniforms,
  setProjectionUniforms,
  toMercator,
  type Program,
} from "./gl";

/** Floats per particle: position (mercator x, y), previous position, age in frames, speed in m/s. */
const STRIDE = 6;

const UPDATE_VERTEX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${SAMPLE_GLSL}
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_prev;
layout(location = 2) in float a_age;
layout(location = 3) in float a_speed;
uniform Grid u_grid;
uniform sampler2D u_wa;
uniform sampler2D u_wb;
uniform int u_has_b;
uniform float u_t;
uniform vec4 u_bounds;   // view in mercator: x0, y0, x1, y1
uniform vec4 u_spawn;    // view in degrees: west, south, east, north (globe spawning)
uniform float u_step;    // mercator units moved per m/s this frame
uniform float u_frames;  // frames elapsed since the last update
uniform float u_life;    // mean lifetime in frames
uniform uint u_seed;
uniform float u_globe;
uniform int u_reset;
out vec2 v_pos;
out vec2 v_prev;
out float v_age;
out float v_speed;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rand(uint a, uint b) { return float(pcg(a ^ pcg(b))) / 4294967295.0; }

void main() {
  uint id = uint(gl_VertexID);
  float life = u_life * (0.5 + rand(id, 7u));
  vec2 pos = a_pos;
  float age = a_age + u_frames;
  bool outside = pos.x < u_bounds.x || pos.x > u_bounds.z || pos.y < u_bounds.y || pos.y > u_bounds.w;
  if (u_reset == 1 || age > life || outside) {
    vec2 r = vec2(rand(id, u_seed), rand(id, u_seed + 1u));
    vec2 p = mix(u_bounds.xy, u_bounds.zw, r);
    if (u_globe > 0.5) {
      // Even by area on a sphere (uniform in sin(lat)), so the poles aren't crowded.
      float lat = degrees(asin(mix(sin(radians(u_spawn.y)), sin(radians(u_spawn.w)), r.y)));
      float s = sin(radians(clamp(lat, -89.5, 89.5)));
      p = vec2((mix(u_spawn.x, u_spawn.z, r.x) + 180.0) / 360.0, 0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * PI_));
    }
    v_pos = p;
    v_prev = p;
    v_age = u_reset == 1 ? floor(rand(id, u_seed + 2u) * life) : 0.0;
    v_speed = 0.0;
    return;
  }
  vec2 ll = mercatorToLonLat(vec2(fract(pos.x), pos.y));
  vec3 wa = fieldVector(u_wa, u_grid, ll.x, ll.y);
  vec3 wb = u_has_b == 1 ? fieldVector(u_wb, u_grid, ll.x, ll.y) : wa;
  if (wa.z < 0.5 || wb.z < 0.5) {
    // No data here (waves reaching land): end this particle; it respawns next frame.
    v_pos = pos;
    v_prev = pos;
    v_age = 1e9;
    v_speed = 0.0;
    return;
  }
  vec2 w = mix(wa.xy, wb.xy, u_t);
  // Mercator stretches toward the poles; on a globe, move faster there to keep screen speed even.
  float stretch = mix(1.0, 1.0 / max(cos(radians(ll.y)), 0.2), u_globe);
  v_prev = pos;
  v_pos = pos + vec2(w.x, -w.y) * u_step * stretch;
  v_age = age;
  v_speed = length(w);
}`;

const UPDATE_FRAGMENT = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

/** Each particle's last move as a short quad (instanced: 6 vertices per particle). */
const SEGMENT_VERTEX = `
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_prev;
layout(location = 2) in float a_age;
layout(location = 3) in float a_speed;
uniform vec2 u_viewport;
uniform float u_width;
uniform float u_max_speed;
out float v_alpha;
out float v_edge;
void main() {
  int c = gl_VertexID;
  float end = (c == 1 || c == 2 || c == 4) ? 1.0 : 0.0;
  float side = (c == 0 || c == 1 || c == 3) ? -1.0 : 1.0;
  vec4 p0 = projectTile(a_prev);
  vec4 p1 = projectTile(a_pos);
  vec2 half_vp = 0.5 * u_viewport;
  vec2 d = (p1.xy / p1.w - p0.xy / p0.w) * half_vp;
  float len = length(d);
  v_alpha = 0.0;
  v_edge = side;
  if (len < 0.01 || len > 100.0 || p0.w <= 0.0 || p1.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 dir = d / len;
  vec2 n = vec2(-dir.y, dir.x);
  vec4 p = end > 0.5 ? p1 : p0;
  vec2 offset = n * side * u_width * 0.5 + dir * (end > 0.5 ? 0.5 : -0.5) * u_width;
  gl_Position = vec4(p.xy + offset / half_vp * p.w, p.z, p.w);
  float fade_in = clamp(a_age / 8.0, 0.0, 1.0);
  v_alpha = fade_in * mix(0.35, 1.0, clamp(a_speed / u_max_speed, 0.0, 1.0));
}`;

const SEGMENT_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_color;
in float v_alpha;
in float v_edge;
out vec4 fragColor;
void main() {
  float a = v_alpha * (1.0 - smoothstep(0.3, 1.0, abs(v_edge)));
  fragColor = vec4(u_color * a, a);
}`;

const QUAD_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FADE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_fade;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  // Multiply, then subtract a step: 8-bit channels would otherwise never quite reach zero.
  fragColor = max(texture(u_tex, v_uv) * u_fade - vec4(1.5 / 255.0), vec4(0.0));
}`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_opacity;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = texture(u_tex, v_uv) * u_opacity; }`;

export interface ParticleOptions {
  /** Screen speed: pixels per frame for each m/s of wind. */
  speed: number;
  /** Mean particle lifetime, in frames. */
  life: number;
  /** Fraction of a trail's brightness kept each frame (higher = longer trails). */
  fade: number;
  /** CSS pixels of screen per particle (lower = more particles). */
  density: number;
  /** Line width in CSS pixels. */
  width: number;
  /** Wind speed (m/s) at which particles reach full brightness. */
  maxSpeed: number;
  color: [number, number, number];
  opacity: number;
}

export const DEFAULT_PARTICLES: ParticleOptions = {
  speed: 0.12,
  life: 90,
  fade: 0.955,
  density: 220,
  width: 1.3,
  maxSpeed: 15,
  color: [1, 1, 1],
  opacity: 0.9,
};

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

/**
 * Animated particles drawn from u/v fields: particles move with the
 * (time-interpolated) wind on the GPU, leaving trails that fade. They follow the map as it moves,
 * in mercator or on a globe.
 */
export class ParticleLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  options: ParticleOptions;
  private map: MapLibreMap | null = null;
  private textures: FieldTextures | null = null;
  private frames: FieldFrames | null = null;
  private vars: [string, string] = ["u10", "v10"];
  private update: Program | null = null;
  private fade: Program | null = null;
  private composite: Program | null = null;
  private segments = new Map<string, Program>();
  private quad: WebGLVertexArrayObject | null = null;
  private feedback: WebGLTransformFeedback | null = null;
  private buffers: WebGLBuffer[] = [];
  private updateVaos: WebGLVertexArrayObject[] = [];
  private drawVaos: WebGLVertexArrayObject[] = [];
  private count = 0;
  private current = 0;
  private targets: Target[] = [];
  private targetSize: [number, number] = [0, 0];
  private seed = 1;
  private reset = true;
  private moving = false;
  private lastTime = 0;
  private readonly onMoveStart = () => (this.moving = true);
  private readonly onMoveEnd = () => {
    this.moving = false;
    this.reset = true;
  };

  constructor(id = "weather-particles", options: Partial<ParticleOptions> = {}) {
    this.id = id;
    this.options = { ...DEFAULT_PARTICLES, ...options };
  }

  /**
   * Steps of a vector field to animate: by default wind (u10, v10). Any eastward/northward pair
   * works, in m/s; cells where it is missing (land, for waves) end the particles that reach them.
   */
  setFrames(frames: FieldFrames | null, vars: [string, string] = ["u10", "v10"]): void {
    const fresh = (!this.frames && frames) || vars.join() !== this.vars.join();
    this.frames = frames;
    this.vars = vars;
    if (fresh) this.reset = true;
    this.map?.triggerRepaint();
  }

  setOptions(options: Partial<ParticleOptions>): void {
    this.options = { ...this.options, ...options };
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.textures = new FieldTextures(gl, 4);
    this.update = createProgram(gl, UPDATE_VERTEX, UPDATE_FRAGMENT, ["v_pos", "v_prev", "v_age", "v_speed"]);
    this.fade = createProgram(gl, QUAD_VERTEX, FADE_FRAGMENT);
    this.composite = createProgram(gl, QUAD_VERTEX, COMPOSITE_FRAGMENT);
    this.quad = screenQuad(gl);
    this.feedback = gl.createTransformFeedback();
    map.on("movestart", this.onMoveStart);
    map.on("moveend", this.onMoveEnd);
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    map.off("movestart", this.onMoveStart);
    map.off("moveend", this.onMoveEnd);
    this.textures?.dispose();
    for (const p of [this.update, this.fade, this.composite, ...this.segments.values()]) if (p) gl.deleteProgram(p.program);
    this.segments.clear();
    this.freeParticles(gl);
    this.freeTargets(gl);
    if (this.quad) gl.deleteVertexArray(this.quad);
    if (this.feedback) gl.deleteTransformFeedback(this.feedback);
    this.map = null;
  }

  private freeParticles(gl: WebGL2RenderingContext): void {
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const v of [...this.updateVaos, ...this.drawVaos]) gl.deleteVertexArray(v);
    this.buffers = [];
    this.updateVaos = [];
    this.drawVaos = [];
    this.count = 0;
  }

  private freeTargets(gl: WebGL2RenderingContext): void {
    for (const t of this.targets) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    this.targets = [];
    this.targetSize = [0, 0];
  }

  private ensureParticles(gl: WebGL2RenderingContext): void {
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    const area = (canvas.width / dpr) * (canvas.height / dpr);
    const want = Math.max(1000, Math.min(65536, Math.round(area / this.options.density)));
    if (want === this.count) return;
    this.freeParticles(gl);
    const data = new Float32Array(want * STRIDE);
    for (let k = 0; k < 2; k++) {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
      this.buffers.push(buf);
      for (const instanced of [false, true]) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        const layout: Array<[number, number, number]> = [
          [0, 2, 0],
          [1, 2, 2],
          [2, 1, 4],
          [3, 1, 5],
        ];
        for (const [loc, size, offset] of layout) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
          gl.vertexAttribDivisor(loc, instanced ? 1 : 0);
        }
        (instanced ? this.drawVaos : this.updateVaos).push(vao);
      }
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.count = want;
    this.current = 0;
    this.reset = true;
  }

  private ensureTargets(gl: WebGL2RenderingContext): boolean {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.targetSize[0] === w && this.targetSize[1] === h) return false;
    this.freeTargets(gl);
    for (let k = 0; k < 2; k++) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.targets.push({ texture, framebuffer });
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targetSize = [w, h];
    return true;
  }

  /**
   * The view, a little larger than the screen: in mercator (x0, y0, x1, y1) and in degrees
   * (west, south, east, north). A globe reaches to the poles; a flat map stops at 85°.
   */
  private viewBounds(globe: boolean): { mercator: [number, number, number, number]; degrees: [number, number, number, number] } {
    const b = this.map!.getBounds();
    let west = b.getWest();
    let east = b.getEast();
    if (east < west) east += 360;
    const limit = globe ? 89.5 : 85.05;
    const north = Math.min(b.getNorth(), limit);
    const south = Math.max(b.getSouth(), -limit);
    const [x0, y0] = toMercator(west, north, limit);
    const [x1, y1] = toMercator(east, south, limit);
    const mx = (x1 - x0) * 0.02;
    const my = (y1 - y0) * 0.02;
    return { mercator: [x0 - mx, y0 - my, x1 + mx, y1 + my], degrees: [west, south, east, north] };
  }

  private segmentProgram(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): Program {
    const name = args.shaderData.variantName;
    let p = this.segments.get(name);
    if (!p) {
      p = createProgram(gl, projectedVertexShader(args, SEGMENT_VERTEX), SEGMENT_FRAGMENT);
      this.segments.set(name, p);
    }
    return p;
  }

  prerender(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const { frames, map, textures, update, fade } = this;
    if (!frames || !map || !textures || !update || !fade || this.options.opacity <= 0) return;
    this.ensureParticles(gl);
    const resized = this.ensureTargets(gl);
    const now = performance.now();
    const elapsed = this.lastTime ? (now - this.lastTime) / (1000 / 60) : 1;
    this.lastTime = now;
    const steps = Math.max(0.25, Math.min(3, elapsed));
    const globe = isGlobe(args);
    const opts = this.options;

    // 1. Move the particles (transform feedback, no drawing).
    const wa = textures.get(frames.a, this.vars);
    const wb = frames.b ? textures.get(frames.b, this.vars) : null;
    gl.useProgram(update.program);
    setGridUniforms(gl, update, frames.a.grid, "u_grid");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, wa);
    gl.uniform1i(update.uniform("u_wa"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wb ?? wa);
    gl.uniform1i(update.uniform("u_wb"), 1);
    gl.uniform1i(update.uniform("u_has_b"), wb ? 1 : 0);
    gl.uniform1f(update.uniform("u_t"), frames.t);
    const view = this.viewBounds(globe);
    gl.uniform4f(update.uniform("u_bounds"), ...view.mercator);
    gl.uniform4f(update.uniform("u_spawn"), ...view.degrees);
    const worldSize = 512 * Math.pow(2, map.getZoom());
    gl.uniform1f(update.uniform("u_step"), (opts.speed * steps) / worldSize);
    gl.uniform1f(update.uniform("u_frames"), steps);
    gl.uniform1f(update.uniform("u_life"), opts.life);
    gl.uniform1ui(update.uniform("u_seed"), (this.seed = (this.seed * 1664525 + 1013904223) >>> 0));
    gl.uniform1f(update.uniform("u_globe"), globe ? 1 : 0);
    gl.uniform1i(update.uniform("u_reset"), this.reset ? 1 : 0);
    const src = this.current;
    const dst = 1 - src;
    gl.bindVertexArray(this.updateVaos[src]!);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[dst]!);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    this.current = dst;
    const wasReset = this.reset;
    this.reset = false;

    // 2. Fade the trails into the other target, then draw this frame's moves on top.
    const [w, h] = this.targetSize;
    const [prev, next] = this.targets as [Target, Target];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.moving && !wasReset && !resized) {
      gl.useProgram(fade.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prev.texture);
      gl.uniform1i(fade.uniform("u_tex"), 0);
      gl.uniform1f(fade.uniform("u_fade"), Math.pow(opts.fade, steps));
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const seg = this.segmentProgram(gl, args);
    gl.useProgram(seg.program);
    setProjectionUniforms(gl, seg, args);
    const dpr = window.devicePixelRatio || 1;
    gl.uniform2f(seg.uniform("u_viewport"), w, h);
    gl.uniform1f(seg.uniform("u_width"), opts.width * dpr);
    gl.uniform1f(seg.uniform("u_max_speed"), opts.maxSpeed);
    gl.uniform3f(seg.uniform("u_color"), ...opts.color);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.drawVaos[this.current]!);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = [next, prev];
  }

  render(gl: WebGL2RenderingContext, _args: CustomRenderMethodInput): void {
    const { frames, map, composite } = this;
    if (!frames || !map || !composite || !this.targets.length || this.options.opacity <= 0) return;
    gl.useProgram(composite.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0]!.texture);
    gl.uniform1i(composite.uniform("u_tex"), 0);
    gl.uniform1f(composite.uniform("u_opacity"), this.options.opacity);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    map.triggerRepaint(); // keep animating
  }
}
