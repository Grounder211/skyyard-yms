// Pulled out of the /api/gate-pass/:id/advance route handler so the stage
// transition rules can be unit-tested without spinning up the whole
// Express app + a live Supabase connection.

export const STAGE_ORDER = ["IN_PASS", "PARKED", "LOADING", "UNLOADING", "READY_FOR_EXIT", "OUT_PASS", "EXITED"] as const;
export type GatePassStage = (typeof STAGE_ORDER)[number];

export interface TransitionCheck {
  ok: boolean;
  error?: string;
}

// Forward-only, one step at a time — skipping a stage (e.g. IN_PASS straight
// to READY_FOR_EXIT) would hide whatever actually happened to the load in
// between. LOADING <-> UNLOADING is the one lateral exception: both mean
// "at the dock, cargo operation active."
export function isLateralDockSwap(from: string, to: string): boolean {
  return (from === "LOADING" && to === "UNLOADING") || (from === "UNLOADING" && to === "LOADING");
}

export function checkStageTransition(
  from: string,
  to: string,
  verification: { license_verified: boolean; vehicle_matched: boolean }
): TransitionCheck {
  if (!STAGE_ORDER.includes(to as GatePassStage)) return { ok: false, error: "Invalid stage" };

  const currentIdx = STAGE_ORDER.indexOf(from as GatePassStage);
  const targetIdx = STAGE_ORDER.indexOf(to as GatePassStage);

  if (!isLateralDockSwap(from, to) && targetIdx !== currentIdx + 1) {
    return { ok: false, error: `Cannot advance from ${from} to ${to} — stages must move forward one at a time` };
  }
  if (from === "IN_PASS" && !(verification.license_verified && verification.vehicle_matched)) {
    return { ok: false, error: "Verify driver license and vehicle match before moving past IN_PASS" };
  }
  return { ok: true };
}
