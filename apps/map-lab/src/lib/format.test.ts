import { describe, expect, it } from "vitest";
import { dayKey, formatCoords, formatUtc, formatValue, formatWave, formatWind } from "./format.ts";

describe("readouts", () => {
  it("formats values, wind, waves and coordinates", () => {
    expect(formatValue(12.345)).toBe("12.3");
    expect(formatValue(12.345, 0)).toBe("12");
    expect(formatValue(null)).toBe("–");
    expect(formatValue(NaN)).toBe("–");
    expect(formatWind(7.26, 247)).toBe("7.3 m/s WSW");
    expect(formatWave(200, 9.4)).toBe("from SSW · 9 s");
    expect(formatCoords(-8.556, 125.56)).toBe("8.56°S 125.56°E");
    expect(formatCoords(51.5, -0.12)).toBe("51.50°N 0.12°W");
  });

  it("formats times in UTC and by local day", () => {
    const t = Date.UTC(2026, 10, 16, 18, 0);
    expect(formatUtc(t)).toBe("18:00 UTC");
    expect(dayKey(t, "UTC")).toBe("2026-11-16");
    expect(dayKey(t, "Asia/Dili")).toBe("2026-11-17");
  });
});
