import { describe, it, expect } from "vitest";
import { checkStageTransition, isLateralDockSwap, isLoadReady, STAGE_ORDER } from "./gatePassStages.js";

const verified = { license_verified: true, vehicle_matched: true };
const unverified = { license_verified: false, vehicle_matched: false };

describe("gatePassStages", () => {
  it("STAGE_ORDER is the exact sequence the DB CHECK constraint allows", () => {
    // Keep this list in sync with the gate_passes.stage CHECK constraint —
    // a drift here means the app and the DB disagree on what's valid.
    expect(STAGE_ORDER).toEqual(["IN_PASS", "PARKED", "LOADING", "UNLOADING", "READY_FOR_EXIT", "OUT_PASS", "EXITED"]);
  });

  it("allows moving one stage forward", () => {
    expect(checkStageTransition("IN_PASS", "PARKED", verified).ok).toBe(true);
    expect(checkStageTransition("PARKED", "LOADING", verified).ok).toBe(true);
    expect(checkStageTransition("READY_FOR_EXIT", "OUT_PASS", verified).ok).toBe(true);
    expect(checkStageTransition("OUT_PASS", "EXITED", verified).ok).toBe(true);
  });

  it("rejects skipping a stage", () => {
    const result = checkStageTransition("PARKED", "OUT_PASS", verified);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/move forward one at a time/);
  });

  it("rejects moving backward", () => {
    const result = checkStageTransition("LOADING", "PARKED", verified);
    expect(result.ok).toBe(false);
  });

  it("allows the LOADING <-> UNLOADING lateral swap both directions", () => {
    expect(checkStageTransition("LOADING", "UNLOADING", verified).ok).toBe(true);
    expect(checkStageTransition("UNLOADING", "LOADING", verified).ok).toBe(true);
  });

  it("does not treat any other pair as a lateral swap", () => {
    expect(isLateralDockSwap("PARKED", "LOADING")).toBe(false);
    expect(isLateralDockSwap("LOADING", "READY_FOR_EXIT")).toBe(false);
    expect(isLateralDockSwap("IN_PASS", "UNLOADING")).toBe(false);
  });

  it("blocks IN_PASS -> PARKED when verification is incomplete", () => {
    const result = checkStageTransition("IN_PASS", "PARKED", unverified);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Verify driver license/);
  });

  it("blocks IN_PASS -> PARKED with only partial verification", () => {
    expect(checkStageTransition("IN_PASS", "PARKED", { license_verified: true, vehicle_matched: false }).ok).toBe(false);
    expect(checkStageTransition("IN_PASS", "PARKED", { license_verified: false, vehicle_matched: true }).ok).toBe(false);
  });

  it("does not require verification for stages after IN_PASS", () => {
    // Verification is only gate-checked leaving IN_PASS — once a pass is
    // already past it, later transitions shouldn't re-demand it.
    expect(checkStageTransition("PARKED", "LOADING", unverified).ok).toBe(true);
  });

  it("rejects an invalid target stage", () => {
    const result = checkStageTransition("IN_PASS", "TELEPORTED", verified);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid stage");
  });

  it("isLoadReady rejects mid-operation cargo statuses", () => {
    expect(isLoadReady("expected")).toBe(false);
    expect(isLoadReady("arrived")).toBe(false);
    expect(isLoadReady("checked")).toBe(false);
    expect(isLoadReady("loading")).toBe(false);
    expect(isLoadReady("unloading")).toBe(false);
  });

  it("isLoadReady accepts terminal cargo statuses", () => {
    expect(isLoadReady("loaded")).toBe(true);
    expect(isLoadReady("unloaded")).toBe(true);
    expect(isLoadReady("short")).toBe(true);
    expect(isLoadReady("over")).toBe(true);
    expect(isLoadReady("damaged")).toBe(true);
    expect(isLoadReady("rejected")).toBe(true);
    expect(isLoadReady("completed")).toBe(true);
  });

  it("isLoadReady treats no cargo status (untracked trailer) as ready", () => {
    expect(isLoadReady(null)).toBe(true);
    expect(isLoadReady(undefined)).toBe(true);
  });
});
