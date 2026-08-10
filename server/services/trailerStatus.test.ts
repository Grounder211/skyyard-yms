import { describe, it, expect } from "vitest";
import { deriveTrailerStatus } from "./trailerStatus.js";

describe("deriveTrailerStatus", () => {
  it("is NOT_ARRIVED when no trailer row exists yet", () => {
    expect(deriveTrailerStatus(null).label).toBe("NOT_ARRIVED");
  });

  it("is DEPARTED once checked out", () => {
    const r = deriveTrailerStatus({ status: "IN_YARD", checked_out_at: "2026-08-09T10:00:00Z", spot_name: null, spot_type: null });
    expect(r.label).toBe("DEPARTED");
  });

  it("is DEPARTED when status is DISPATCHED even without a checkout timestamp", () => {
    const r = deriveTrailerStatus({ status: "DISPATCHED", checked_out_at: null, spot_name: null, spot_type: null });
    expect(r.label).toBe("DEPARTED");
  });

  it("is AT_DOCK when parked at a dock-type spot", () => {
    const r = deriveTrailerStatus({ status: "IN_YARD", checked_out_at: null, spot_name: "D-02", spot_type: "DOCK" });
    expect(r.label).toBe("AT_DOCK");
    expect(r.detail).toContain("D-02");
  });

  it("is IN_YARD when parked at a parking-type spot", () => {
    const r = deriveTrailerStatus({ status: "IN_YARD", checked_out_at: null, spot_name: "P-07", spot_type: "PARKING" });
    expect(r.label).toBe("IN_YARD");
    expect(r.detail).toContain("P-07");
  });

  it("is IN_YARD with no spot detail when unassigned", () => {
    const r = deriveTrailerStatus({ status: "IN_YARD", checked_out_at: null, spot_name: null, spot_type: null });
    expect(r.label).toBe("IN_YARD");
  });
});
