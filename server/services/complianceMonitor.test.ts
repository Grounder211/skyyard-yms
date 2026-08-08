import { describe, it, expect } from "vitest";
import { evaluateSla, isNoShow } from "./complianceMonitor.js";

describe("evaluateSla", () => {
  it("is ok well under threshold", () => {
    expect(evaluateSla(30, 90, 80, 100, 120)).toBe("ok");
  });

  it("is warning at the warning_pct boundary", () => {
    expect(evaluateSla(72, 90, 80, 100, 120)).toBe("warning"); // 80%
  });

  it("is breach at the escalation_pct boundary", () => {
    expect(evaluateSla(90, 90, 80, 100, 120)).toBe("breach"); // 100%
  });

  it("is critical at the critical_pct boundary", () => {
    expect(evaluateSla(108, 90, 80, 100, 120)).toBe("critical"); // 120%
  });

  it("respects custom per-facility/load-type thresholds instead of the old hardcoded 100/120", () => {
    // A stricter facility config: warn at 50%, breach at 70%, critical at 90%.
    expect(evaluateSla(50, 100, 50, 70, 90)).toBe("warning");
    expect(evaluateSla(75, 100, 50, 70, 90)).toBe("breach");
    expect(evaluateSla(95, 100, 50, 70, 90)).toBe("critical");
  });
});

describe("isNoShow", () => {
  it("is not a no-show within the grace period", () => {
    const now = new Date("2026-08-10T09:30:00Z").toISOString();
    const start = new Date("2026-08-10T09:00:00Z").toISOString(); // 30 min ago
    expect(isNoShow(start, 60, now)).toBe(false);
  });

  it("is a no-show past the grace period", () => {
    const now = new Date("2026-08-10T10:15:00Z").toISOString();
    const start = new Date("2026-08-10T09:00:00Z").toISOString(); // 75 min ago
    expect(isNoShow(start, 60, now)).toBe(true);
  });

  it("uses a 60-minute default when grace_period_minutes is not set", () => {
    const now = new Date("2026-08-10T10:15:00Z").toISOString();
    const start = new Date("2026-08-10T09:00:00Z").toISOString(); // 75 min ago
    expect(isNoShow(start, null, now)).toBe(true);
    expect(isNoShow(start, undefined, now)).toBe(true);
  });

  it("respects a per-appointment grace period different from the default", () => {
    const now = new Date("2026-08-10T09:20:00Z").toISOString();
    const start = new Date("2026-08-10T09:00:00Z").toISOString(); // 20 min ago
    expect(isNoShow(start, 15, now)).toBe(true); // shorter grace than default
    expect(isNoShow(start, 30, now)).toBe(false); // longer grace than default
  });
});
