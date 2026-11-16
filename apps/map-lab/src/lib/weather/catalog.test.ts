import { describe, expect, it } from "vitest";
import { COLOR_LAYERS, WIND_VARS } from "./catalog.ts";

describe("layer catalog", () => {
  it("has one entry per layer, each with a legend, a tile variable and sane decimals", () => {
    const ids = COLOR_LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of COLOR_LAYERS) {
      expect(l.label).toMatch(/^[A-Z]/);
      expect(l.vars.length === 1 || l.vars.length === 2).toBe(true);
      expect(l.legendVar && l.tileVar).toBeTruthy();
      expect(l.decimals).toBeGreaterThanOrEqual(0);
      expect(l.decimals).toBeLessThanOrEqual(2);
    }
  });

  it("draws wind from its components, and moves wave layers with the waves", () => {
    expect(COLOR_LAYERS.find((l) => l.id === "wind")?.vars).toEqual(WIND_VARS);
    for (const l of COLOR_LAYERS.filter((x) => x.flow)) {
      expect(l.flow!.dir).toMatch(/_dir$/);
      expect(l.flow!.period).toMatch(/_period$/);
    }
  });
});
