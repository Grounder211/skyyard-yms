import { describe, it, expect } from "vitest";
import { estimateDurationMinutes, estimateEndTime, intervalsOverlap } from "./appointmentDuration.js";

describe("estimateDurationMinutes", () => {
  it("gives each load type its own base duration", () => {
    expect(estimateDurationMinutes("standard")).toBe(45);
    expect(estimateDurationMinutes("flatbed")).toBe(60);
    expect(estimateDurationMinutes("reefer")).toBe(75);
    expect(estimateDurationMinutes("tanker")).toBe(90);
    expect(estimateDurationMinutes("hazmat")).toBe(90);
    expect(estimateDurationMinutes("oversized")).toBe(120);
  });

  it("is case-insensitive on load type", () => {
    expect(estimateDurationMinutes("REEFER")).toBe(75);
  });

  it("falls back to a default for unknown or missing load types", () => {
    expect(estimateDurationMinutes("mystery-cargo")).toBe(60);
    expect(estimateDurationMinutes(undefined)).toBe(60);
    expect(estimateDurationMinutes(null)).toBe(60);
  });

  it("adds time for heavy loads over 20 tonnes", () => {
    expect(estimateDurationMinutes("standard", 20000)).toBe(45);
    expect(estimateDurationMinutes("standard", 30000)).toBe(60); // +1 x 15 min (10t over)
    expect(estimateDurationMinutes("standard", 40000)).toBe(75); // +2 x 15 min (20t over)
  });

  it("caps the heavy-load bonus so a data-entry typo can't blow up the slot", () => {
    expect(estimateDurationMinutes("standard", 500000)).toBe(45 + 60);
  });
});

describe("estimateEndTime", () => {
  it("adds the estimated duration to the start time", () => {
    const end = estimateEndTime("2026-08-10T08:00:00.000Z", "reefer");
    expect(end).toBe("2026-08-10T09:15:00.000Z"); // +75 min
  });
});

describe("intervalsOverlap", () => {
  it("detects a genuine overlap", () => {
    expect(intervalsOverlap("2026-08-10T08:00:00Z", "2026-08-10T09:15:00Z", "2026-08-10T09:00:00Z", "2026-08-10T10:00:00Z")).toBe(true);
  });

  it("treats back-to-back intervals (touching, not crossing) as non-overlapping", () => {
    expect(intervalsOverlap("2026-08-10T08:00:00Z", "2026-08-10T09:00:00Z", "2026-08-10T09:00:00Z", "2026-08-10T10:00:00Z")).toBe(false);
  });

  it("detects no overlap when intervals are far apart", () => {
    expect(intervalsOverlap("2026-08-10T08:00:00Z", "2026-08-10T08:45:00Z", "2026-08-10T12:00:00Z", "2026-08-10T13:00:00Z")).toBe(false);
  });

  it("detects overlap when one interval fully contains the other", () => {
    expect(intervalsOverlap("2026-08-10T08:00:00Z", "2026-08-10T12:00:00Z", "2026-08-10T09:00:00Z", "2026-08-10T10:00:00Z")).toBe(true);
  });
});
