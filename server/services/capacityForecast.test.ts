import { describe, it, expect } from "vitest";
import { forecastOccupancy } from "./capacityForecast.js";

describe("forecastOccupancy", () => {
  const windows = [30, 60, 120, 240];

  it("adds arrivals and subtracts departures per window", () => {
    const r = forecastOccupancy(10, 20, [2, 4, 6, 8], [1, 1, 2, 2], windows, 90);
    expect(r.map((w) => w.expectedOccupied)).toEqual([11, 13, 14, 16]);
  });

  it("never forecasts above total capacity", () => {
    const r = forecastOccupancy(18, 20, [10, 10, 10, 10], [0, 0, 0, 0], windows, 90);
    expect(r.every((w) => w.expectedOccupied <= 20)).toBe(true);
    expect(r[0].pct).toBe(100);
  });

  it("never forecasts below zero", () => {
    const r = forecastOccupancy(1, 20, [0, 0, 0, 0], [5, 5, 5, 5], windows, 90);
    expect(r.every((w) => w.expectedOccupied >= 0)).toBe(true);
  });

  it("flags at-risk once the threshold percentage is reached", () => {
    const r = forecastOccupancy(17, 20, [1, 2, 3, 3], [0, 0, 0, 0], windows, 90);
    expect(r[0].atRisk).toBe(true); // 18/20 = 90%
    expect(r[3].atRisk).toBe(true);
  });

  it("does not flag at-risk below the threshold", () => {
    const r = forecastOccupancy(5, 20, [1, 1, 1, 1], [0, 0, 0, 0], windows, 90);
    expect(r.every((w) => w.atRisk)).toBe(false);
  });

  it("reports 0% rather than dividing by zero when there are no spots", () => {
    const r = forecastOccupancy(0, 0, [1, 1, 1, 1], [0, 0, 0, 0], windows, 90);
    expect(r[0].pct).toBe(0);
  });
});
