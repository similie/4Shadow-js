import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { createProgram, parseColor, SCREEN_VERTEX, screenQuad, type Program } from "./gl";
import type { SeaMask } from "./sea-mask";

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_sea;
uniform vec4 u_color;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  float sea = texture(u_sea, v_uv).a;
  if (sea < 0.004) discard;
  fragColor = u_color * sea;
}`;

/**
 * Seas and lakes shaded over the weather, so land and sea differ in tone under layers that colour
 * both alike. It is drawn from the SeaMask, not as a fill layer: on a globe MapLibre extends fills
 * that reach the top of the map to the North Pole, and a translucent fill's caps overlap into a dark
 * disc over the Arctic. One pass over the screen can't overlap itself, flat or on a globe.
 *
 * Add it just above the weather, under roads, borders and labels.
 */
export class SeaShadeLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  private readonly seaMask: SeaMask;
  private map: MapLibreMap | null = null;
  private program: Program | null = null;
  private quad: WebGLVertexArrayObject | null = null;
  /** Premultiplied RGBA. */
  private color: [number, number, number, number] = [0, 0, 0, 0];

  constructor(seaMask: SeaMask, id = "weather-sea-shade") {
    this.id = id;
    this.seaMask = seaMask;
  }

  /** A colour ("#rrggbb") and how strongly it covers the water (0 to 1; 0 turns the shade off). */
  setColor(hex: string, opacity: number): void {
    const [r, g, b] = parseColor(hex);
    this.color = [r * opacity, g * opacity, b * opacity, opacity];
    this.seaMask.use(this.id, opacity > 0);
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.program = createProgram(gl, SCREEN_VERTEX, FRAGMENT);
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
    if (!map || !program || this.color[3] <= 0) return;
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
    gl.uniform4fv(program.uniform("u_color"), this.color);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    // Over the colour, as a translucent fill would be; the alpha (opaque water) stays as it is.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
