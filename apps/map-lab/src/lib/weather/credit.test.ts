import { describe, expect, it } from "vitest";
import type { RunDetail } from "@similie/4shadow";
import { creditFor } from "./credit.ts";

const run = (model: string, source: Record<string, unknown>) => ({ model, source }) as unknown as RunDetail;

describe("forecast credit", () => {
  it("uses the licence's own words when the source gives them, else names who made it", () => {
    const ecmwf = "Contains ECMWF open data, © European Centre for Medium-Range Weather Forecasts (ECMWF), licensed under CC BY 4.0.";
    expect(creditFor(run("ifs", { provider: "ECMWF Integrated Forecasting System", attribution: ecmwf }))).toBe(ecmwf);
    expect(creditFor(run("gfs", { provider: "NOAA/NCEP Global Forecast System (GFS), 0.25°" }))).toBe("Forecast: NOAA via 4Shadow");
    expect(creditFor(run("new", {}))).toBe("Forecast: NEW via 4Shadow");
  });
});
