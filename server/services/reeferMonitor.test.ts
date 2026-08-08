import { describe, it, expect } from "vitest";
import { evaluateReading, isReadingStale, STALE_READING_HOURS } from "./reeferMonitor.js";

describe("evaluateReading", () => {
  it("is ok for a normal temperature with no setpoint", () => {
    expect(evaluateReading(-2).status).toBe("ok");
  });

  it("is critical outside the default safe range when no setpoint is set", () => {
    expect(evaluateReading(15).status).toBe("critical");
    expect(evaluateReading(-30).status).toBe("critical");
  });

  it("is ok close to the setpoint", () => {
    const r = evaluateReading(-18.5, null, -18);
    expect(r.status).toBe("ok");
  });

  it("is warning for a moderate deviation from setpoint", () => {
    const r = evaluateReading(-15, null, -18);
    expect(r.status).toBe("warning");
    expect(r.reasons[0]).toMatch(/drifting/);
  });

  it("is critical for a large deviation from setpoint", () => {
    const r = evaluateReading(-10, null, -18);
    expect(r.status).toBe("critical");
    expect(r.reasons[0]).toMatch(/off the/);
  });

  it("flags low fuel independently of temperature", () => {
    expect(evaluateReading(-18, 20, -18).status).toBe("warning");
    expect(evaluateReading(-18, 5, -18).status).toBe("critical");
  });

  it("critical wins even if temperature alone would only be a warning", () => {
    const r = evaluateReading(-15, 5, -18); // temp = warning, fuel = critical
    expect(r.status).toBe("critical");
    expect(r.reasons.length).toBe(2);
  });

  it("collects reasons for every problem, not just the first", () => {
    const r = evaluateReading(-10, 3, -18);
    expect(r.reasons.length).toBe(2);
  });
});

describe("isReadingStale", () => {
  it("is not stale within the threshold", () => {
    const now = new Date("2026-08-10T12:00:00Z").toISOString();
    const recorded = new Date("2026-08-10T10:00:00Z").toISOString(); // 2h ago
    expect(isReadingStale(recorded, now)).toBe(false);
  });

  it("is stale past the threshold", () => {
    const now = new Date("2026-08-10T12:00:00Z").toISOString();
    const recorded = new Date("2026-08-10T07:00:00Z").toISOString(); // 5h ago
    expect(isReadingStale(recorded, now)).toBe(true);
  });

  it("respects a custom threshold", () => {
    const now = new Date("2026-08-10T12:00:00Z").toISOString();
    const recorded = new Date("2026-08-10T11:00:00Z").toISOString(); // 1h ago
    expect(isReadingStale(recorded, now, 0.5)).toBe(true);
  });

  it("exports the default threshold used by the needs-attention aggregator", () => {
    expect(STALE_READING_HOURS).toBe(4);
  });
});
