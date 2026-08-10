import { describe, it, expect } from "vitest";
import { assessDetentionRisk } from "./detentionRisk.js";

describe("assessDetentionRisk", () => {
  const rules = { thresholdMinutes: 24 * 60, ratePerHour: 75 };

  it("is not at risk when dwell time is nowhere near the threshold", () => {
    const r = assessDetentionRisk({ plate: "T1", checkedInAtIso: "2026-08-10T08:00:00Z" }, rules, "2026-08-10T09:00:00Z");
    expect(r.atRisk).toBe(false);
    expect(r.dwellMinutes).toBe(60);
  });

  it("is at risk when the threshold is crossed within the warning window", () => {
    // checked in 23h10m ago, threshold is 24h -> 50 minutes to go
    const r = assessDetentionRisk({ plate: "T1", checkedInAtIso: "2026-08-09T10:50:00Z" }, rules, "2026-08-10T10:00:00Z");
    expect(r.atRisk).toBe(true);
    expect(r.minutesUntilThreshold).toBe(50);
    expect(r.reason).toContain("$75.00");
  });

  it("is not at risk once the threshold has already been crossed (that's detention_records' job)", () => {
    const r = assessDetentionRisk({ plate: "T1", checkedInAtIso: "2026-08-08T10:00:00Z" }, rules, "2026-08-10T10:00:00Z");
    expect(r.atRisk).toBe(false);
    expect(r.minutesUntilThreshold).toBeLessThan(0);
  });

  it("respects a custom warning window", () => {
    // 90 minutes to go, default window is 60 -> not at risk; wider window -> at risk
    const trailer = { plate: "T1", checkedInAtIso: "2026-08-09T23:30:00Z" };
    const now = "2026-08-10T22:00:00Z";
    expect(assessDetentionRisk(trailer, rules, now).atRisk).toBe(false);
    expect(assessDetentionRisk(trailer, rules, now, 120).atRisk).toBe(true);
  });
});
