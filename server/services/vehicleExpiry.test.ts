import { describe, it, expect } from "vitest";
import { shouldNotifyExpiry } from "./vehicleExpiry.js";

describe("shouldNotifyExpiry", () => {
  const today = "2026-08-08";

  it("notifies when expiry is within the threshold window", () => {
    expect(shouldNotifyExpiry("2026-08-15", null, 14, today)).toBe(true);
  });

  it("notifies for an already-overdue expiry", () => {
    expect(shouldNotifyExpiry("2026-07-01", null, 14, today)).toBe(true);
  });

  it("does not notify when expiry is well beyond the threshold", () => {
    expect(shouldNotifyExpiry("2026-12-01", null, 14, today)).toBe(false);
  });

  it("does not re-notify once already notified for this expiry date", () => {
    expect(shouldNotifyExpiry("2026-08-15", "2026-08-01T00:00:00Z", 14, today)).toBe(false);
  });

  it("does not notify when there is no expiry date on file", () => {
    expect(shouldNotifyExpiry(null, null, 14, today)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(shouldNotifyExpiry("2026-08-20", null, 7, today)).toBe(false);
    expect(shouldNotifyExpiry("2026-08-20", null, 30, today)).toBe(true);
  });
});
