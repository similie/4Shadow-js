// Against a real server: FORESHADOW_TEST_URL=http://localhost:5003 npm test
import { describe, expect, it } from "vitest";
import { ForeshadowClient } from "../src/index.js";

const url = process.env.FORESHADOW_TEST_URL;

describe.skipIf(!url)("live API", () => {
  const c = new ForeshadowClient({ baseUrl: url, apiKey: process.env.FORESHADOW_API_KEY });
  it("decodes a real field and agrees with the point forecast", async () => {
    const run = await c.run();
    const field = await c.field({ vars: ["t2m", "u10", "v10"], time: run.forecast_hours[1]!, run: run.run, stride: 1 });
    expect(field.grid.nlat).toBe(721);
    const fc = await c.forecast({ lat: -8.55, lon: 125.57 }, { vars: ["t2m"], start: "run", hours: 2, daily: false, run: run.run });
    const fromForecast = (fc.timeseries.t2m as number[])[1]!;
    expect(field.sample("t2m", -8.55, 125.57)).toBeCloseTo(fromForecast, 1);
  });
});
