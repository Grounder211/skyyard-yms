import { describe, it, expect } from "vitest";
import { rankHostlersByWorkload } from "./hostlerRecommendation.js";

describe("rankHostlersByWorkload", () => {
  it("recommends the on-shift hostler with the lightest workload", () => {
    const hostlers = [
      { id: 1, name: "Alice", onShift: true },
      { id: 2, name: "Bob", onShift: true },
    ];
    const activeMoves = [{ assigned_to: 1 }, { assigned_to: 1 }, { assigned_to: 2 }];
    const ranked = rankHostlersByWorkload(hostlers, activeMoves);
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].recommended).toBe(true);
    expect(ranked[0].activeMoveCount).toBe(1);
    expect(ranked[1].recommended).toBe(false);
  });

  it("never recommends an off-shift hostler even with zero workload", () => {
    const hostlers = [
      { id: 1, name: "Alice", onShift: false },
      { id: 2, name: "Bob", onShift: true },
    ];
    const activeMoves = [{ assigned_to: 2 }];
    const ranked = rankHostlersByWorkload(hostlers, activeMoves);
    expect(ranked.find((h) => h.recommended)?.id).toBe(2);
    expect(ranked.find((h) => h.id === 1)?.reason).toBe("Off shift");
  });

  it("sorts on-shift hostlers before off-shift ones regardless of workload", () => {
    const hostlers = [
      { id: 1, name: "Alice", onShift: false },
      { id: 2, name: "Bob", onShift: true },
    ];
    const activeMoves = [{ assigned_to: 2 }, { assigned_to: 2 }, { assigned_to: 2 }];
    const ranked = rankHostlersByWorkload(hostlers, activeMoves);
    expect(ranked[0].id).toBe(2);
    expect(ranked[1].id).toBe(1);
  });

  it("marks no one recommended when nobody is on shift", () => {
    const hostlers = [{ id: 1, name: "Alice", onShift: false }];
    const ranked = rankHostlersByWorkload(hostlers, []);
    expect(ranked.every((h) => !h.recommended)).toBe(true);
  });

  it("handles no hostlers", () => {
    expect(rankHostlersByWorkload([], [])).toEqual([]);
  });

  it("ignores unassigned move orders in the workload count", () => {
    const hostlers = [{ id: 1, name: "Alice", onShift: true }];
    const activeMoves = [{ assigned_to: null }, { assigned_to: null }];
    const ranked = rankHostlersByWorkload(hostlers, activeMoves);
    expect(ranked[0].activeMoveCount).toBe(0);
    expect(ranked[0].reason).toBe("On shift, no active moves");
  });
});
