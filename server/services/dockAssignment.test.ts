import { describe, it, expect } from "vitest";
import { resolveDockAssignment, type DockCandidate } from "./dockAssignment";

const dock = (id: number, occupantTrailerId: number | null, occupantPlate: string | null = null): DockCandidate => ({
  id,
  name: `D${id}`,
  zoneName: null,
  occupantTrailerId,
  occupantPlate,
});

describe("resolveDockAssignment", () => {
  it("auto-picks the single free dock when none requested", () => {
    const result = resolveDockAssignment([dock(1, null), dock(2, 5)], undefined, undefined);
    expect(result).toEqual({ action: "auto", dockId: 1 });
  });

  it("asks the admin when multiple docks are free", () => {
    const result = resolveDockAssignment([dock(1, null), dock(2, null)], undefined, undefined);
    expect(result.action).toBe("needsSelection");
  });

  it("asks the admin when zero docks are free", () => {
    const result = resolveDockAssignment([dock(1, 5, "ABC")], undefined, undefined);
    expect(result).toEqual({
      action: "needsSelection",
      available: [],
      occupied: [dock(1, 5, "ABC")],
    });
  });

  it("moves straight in when the requested dock is empty", () => {
    const result = resolveDockAssignment([dock(1, null), dock(2, 5)], 1, undefined);
    expect(result).toEqual({ action: "move", dockId: 1 });
  });

  it("requires swap confirmation for an occupied requested dock", () => {
    const result = resolveDockAssignment([dock(1, 5, "ABC-123")], 1, undefined);
    expect(result).toEqual({
      action: "needsSwapConfirmation",
      dockId: 1,
      occupantTrailerId: 5,
      occupantPlate: "ABC-123",
    });
  });

  it("swaps once the occupant trailer id is confirmed", () => {
    const result = resolveDockAssignment([dock(1, 5, "ABC-123")], 1, 5);
    expect(result).toEqual({ action: "swap", dockId: 1, occupantTrailerId: 5 });
  });

  it("rejects a dock id that isn't in the compatible list", () => {
    const result = resolveDockAssignment([dock(1, null)], 99, undefined);
    expect(result.action).toBe("invalid");
  });
});
