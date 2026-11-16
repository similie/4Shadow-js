import { describe, expect, it } from "vitest";
import type { VariableInfo } from "@similie/4shadow";
import { COLOR_LAYERS, layersFor, servable, WIND_VARS } from "./catalog.ts";

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
    for (const l of COLOR_LAYERS.filter((x) => x.winds)) expect(l.vars).toEqual(l.winds); // its own wind, drawn and moving
    for (const l of COLOR_LAYERS.filter((x) => x.flow)) {
      expect(l.flow!.dir).toMatch(/_dir$/);
      expect(l.flow!.period).toMatch(/_period$/);
    }
  });
});

describe("layers a run can draw", () => {
  const v = (id: string, derived_from?: string[]) => ({ id, derived_from }) as VariableInfo;
  const catalog = [v("t2m"), v("rh2m"), v("refc"), v("wet_bulb", ["t2m", "rh2m"]), v("u10"), v("v10"), v("wind_speed", ["u10", "v10"])];

  it("serves stored variables and those computed from them, not ones the run lacks", () => {
    const old = ["t2m", "rh2m", "u10", "v10"]; // a run from before radar was added
    expect(servable("wet_bulb", catalog, old)).toBe(true);
    expect(servable("refc", catalog, old)).toBe(false);
    expect(servable("refc", catalog, [...old, "refc"])).toBe(true);
    expect(servable("no_such", catalog, old)).toBe(false);
  });

  it("offers a layer only when all of its variables are servable", () => {
    const ids = layersFor(catalog, ["t2m", "rh2m", "u10", "v10"]).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["t2m", "wind", "wet_bulb"]));
    expect(ids).not.toContain("radar");
  });
});
