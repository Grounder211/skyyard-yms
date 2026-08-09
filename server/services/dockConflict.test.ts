import { describe, it, expect } from "vitest";
import { findDockConflict } from "./dockConflict.js";

const base = { dock_id: 5, start_time: "2026-08-09T10:00:00.000Z", end_time: "2026-08-09T11:00:00.000Z", load_type: "standard" };

describe("findDockConflict", () => {
  it("allows a candidate with no dock assigned", () => {
    expect(findDockConflict({ ...base, dock_id: null }, [], null)).toBeNull();
  });

  it("flags an overlapping window at the same dock", () => {
    const existing = [{ dock_id: 5, start_time: "2026-08-09T10:30:00.000Z", end_time: "2026-08-09T11:30:00.000Z", status: "SCHEDULED", load_type: "standard" }];
    expect(findDockConflict(base, existing, null)).not.toBeNull();
  });

  it("allows a back-to-back, non-overlapping window at the same dock", () => {
    const existing = [{ dock_id: 5, start_time: "2026-08-09T11:00:00.000Z", end_time: "2026-08-09T12:00:00.000Z", status: "SCHEDULED", load_type: "standard" }];
    expect(findDockConflict(base, existing, null)).toBeNull();
  });

  it("ignores overlapping windows at a different dock", () => {
    const existing = [{ dock_id: 9, start_time: "2026-08-09T10:00:00.000Z", end_time: "2026-08-09T11:00:00.000Z", status: "SCHEDULED", load_type: "standard" }];
    expect(findDockConflict(base, existing, null)).toBeNull();
  });

  it("ignores a cancelled appointment even if it overlaps", () => {
    const existing = [{ dock_id: 5, start_time: "2026-08-09T10:00:00.000Z", end_time: "2026-08-09T11:00:00.000Z", status: "CANCELLED", load_type: "standard" }];
    expect(findDockConflict(base, existing, null)).toBeNull();
  });

  it("flags an equipment type the dock doesn't accept", () => {
    const result = findDockConflict({ ...base, load_type: "tanker" }, [], ["standard", "reefer"]);
    expect(result?.reason).toMatch(/tanker/);
  });

  it("allows an equipment type the dock accepts", () => {
    expect(findDockConflict({ ...base, load_type: "reefer" }, [], ["standard", "reefer"])).toBeNull();
  });
});
