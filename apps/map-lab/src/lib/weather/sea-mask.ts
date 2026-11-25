import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

/**
 * Where the basemap drew water, as seen on screen. Add it just before the weather, where only the
 * water is opaque yet (see basemap.ts): each frame it copies the screen so far, whose alpha is then
 * the sea. Sea-only particles (waves) are clipped to it and the coastlines are traced from it, so
 * both follow the basemap's own coast at every zoom.
 *
 * Copying costs a full-screen blit, so it only happens while some layer needs it (`use`).
 */
export class SeaMask implements CustomLayerInterface {
  readonly id: string;
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  private readonly users = new Set<string>();
  private map: MapLibreMap | null = null;
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private size: [number, number] = [0, 0];
  /** Frames started (prerender) and the one whose water the texture holds. */
  private frame = 0;
  private copied = -1;

  constructor(id = "weather-sea-mask") {
    this.id = id;
  }

  /** Whether `user` needs the water copied each frame. */
  use(user: string, on: boolean): void {
    const was = this.users.size > 0;
    if (on) this.users.add(user);
    else this.users.delete(user);
    if (!was && this.users.size > 0) this.map?.triggerRepaint();
  }

  get enabled(): boolean {
    return this.users.size > 0;
  }

  onAdd(map: MapLibreMap): void {
    this.map = map;
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    this.texture = null;
    this.framebuffer = null;
    this.size = [0, 0];
    this.map = null;
  }

  /**
   * This frame's water (alpha 1 on water, 0 elsewhere, filtered linearly), for layers drawn after
   * it in the same frame; null when it wasn't copied this frame (then wait for the next).
   */
  current(): WebGLTexture | null {
    return this.copied === this.frame ? this.texture : null;
  }

  prerender(): void {
    this.frame++;
  }

  render(gl: WebGL2RenderingContext): void {
    if (!this.enabled) return;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (!this.texture || this.size[0] !== w || this.size[1] !== h) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
      this.texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      // Linear: the coastlines sample it between pixels, for smooth edges.
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.framebuffer = gl.createFramebuffer()!;
      const target = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      this.size = [w, h];
    }
    // A blit, not a copy: it also resolves the map's framebuffer if that is multisampled.
    const target = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    this.copied = this.frame;
  }
}
