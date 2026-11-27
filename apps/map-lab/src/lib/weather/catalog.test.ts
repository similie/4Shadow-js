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
    // Its own wind or current, drawn and moving; Tides colours the tide's height and moves with the current.
    for (const l of COLOR_LAYERS.filter((x) => x.winds)) expect(l.vars).toEqual(l.id === "tides" ? ["tide_height"] : l.winds);
    expect(COLOR_LAYERS.find((l) => l.id === "tides")).toMatchObject({ winds: ["current_u", "current_v"], current: true });
    for (const l of COLOR_LAYERS.filter((x) => x.flow)) {
      expect(l.flow!.dir).toMatch(/_dir$/);
      expect(l.flow!.period).toMatch(/_period$/);
    }
  });
});

describe("satellite layers", () => {
  it("draw the satellite's own variables, without particles", () => {
    const sat = COLOR_LAYERS.filter((l) => l.still);
    expect(sat.map((l) => l.id)).toEqual(["satellite", "sat_wv", "sat_vis"]);
    for (const l of sat) expect([...l.vars, l.legendVar, l.tileVar].every((v) => v.startsWith("sat_"))).toBe(true);
    // GFS's visibility ("vis") is another layer: a satellite run's variables never share its ids.
    expect(COLOR_LAYERS.find((l) => l.id === "vis")?.vars).toEqual(["vis"]);
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

  it("adds the layers another model's run can draw over it, such as air quality", () => {
    const air = { catalog: [v("pm25"), v("aod_om"), v("aod_bc"), v("smoke_aod", ["aod_om", "aod_bc"])], stored: ["pm25", "aod_om", "aod_bc"] };
    const ids = layersFor(catalog, ["t2m", "rh2m", "u10", "v10"], [air]).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["t2m", "wind", "pm25", "smoke_aod"]));
    expect(ids).not.toContain("pm10");
    expect(ids.indexOf("pm25")).toBeGreaterThan(ids.indexOf("t2m")); // menu order stays the catalog's
  });

  it("offers CAMS's index and gases, and its particles where it's the only air-quality model", () => {
    const gas = ["aqi", "no2", "o3", "co", "so2"];
    const cams = { catalog: [...gas, "pm25", "pm10"].map((id) => v(id)), stored: [...gas, "pm25", "pm10"] };
    const ids = layersFor(catalog, ["t2m", "rh2m", "u10", "v10"], [cams]).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining([...gas, "pm25", "pm10"]));
    expect(ids).not.toContain("aod");
    for (const id of gas) expect(COLOR_LAYERS.find((l) => l.id === id)?.vars).toEqual([id]);
  });
});
