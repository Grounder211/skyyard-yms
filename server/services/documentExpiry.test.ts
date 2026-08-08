import { describe, it, expect } from "vitest";
import { daysUntil, nextExpiryAlertLevel } from "./documentExpiry.js";

describe("daysUntil", () => {
  it("counts whole days between today and a future date", () => {
    expect(daysUntil("2026-08-20", "2026-08-10")).toBe(10);
  });

  it("is negative for a past date (already expired)", () => {
    expect(daysUntil("2026-08-05", "2026-08-10")).toBe(-5);
  });

  it("is zero for today", () => {
    expect(daysUntil("2026-08-10", "2026-08-10")).toBe(0);
  });
});

describe("nextExpiryAlertLevel", () => {
  it("returns null when the document isn't within any threshold yet", () => {
    expect(nextExpiryAlertLevel("2026-09-15", null, "2026-08-10")).toBe(null); // 36 days out
  });

  it("returns the tightest matching level, not the loosest, when several match", () => {
    // 10 days out matches both the 30-day and 14-day thresholds — should alert at 14.
    expect(nextExpiryAlertLevel("2026-08-20", null, "2026-08-10")).toBe(14);
  });

  it("returns 30 when just inside the widest threshold", () => {
    expect(nextExpiryAlertLevel("2026-09-09", null, "2026-08-10")).toBe(30); // 30 days out
  });

  it("returns 0 for an already-expired document", () => {
    expect(nextExpiryAlertLevel("2026-08-05", null, "2026-08-10")).toBe(0);
  });

  it("does not re-alert at the same level already recorded", () => {
    expect(nextExpiryAlertLevel("2026-08-20", 14, "2026-08-10")).toBe(null);
  });

  it("does not re-alert at a looser level than what's already recorded", () => {
    // Already alerted at 7; still 10 days out (which would map to 14) — no new alert.
    expect(nextExpiryAlertLevel("2026-08-20", 7, "2026-08-13")).toBe(null);
  });

  it("does alert again when the document has moved into a tighter level", () => {
    // Alerted at 14 previously; now only 5 days out — should escalate to 7.
    expect(nextExpiryAlertLevel("2026-08-15", 14, "2026-08-10")).toBe(7);
  });

  it("escalates all the way to expired (0) once the date has passed", () => {
    expect(nextExpiryAlertLevel("2026-08-08", 1, "2026-08-10")).toBe(0);
  });
});
