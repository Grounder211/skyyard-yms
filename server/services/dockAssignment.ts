export interface DockCandidate {
  id: number;
  name: string;
  zoneName: string | null;
  occupantTrailerId: number | null;
  occupantPlate: string | null;
}

export type DockAssignmentDecision =
  | { action: "auto"; dockId: number }
  | { action: "needsSelection"; available: DockCandidate[]; occupied: DockCandidate[] }
  | { action: "needsSwapConfirmation"; dockId: number; occupantTrailerId: number; occupantPlate: string }
  | { action: "move"; dockId: number }
  | { action: "swap"; dockId: number; occupantTrailerId: number }
  | { action: "invalid"; error: string };

// PARKED -> LOADING used to just flip a status label with no connection to
// where the trailer actually is. This decides what a stage advance should
// physically do: auto-place into the one obvious free dock, ask when
// there's a real choice, or offer a swap when nothing's free — never
// silently guess, never just fail with no path forward.
export function resolveDockAssignment(
  compatibleDocks: DockCandidate[],
  requestedDockId: number | undefined,
  confirmSwapWithTrailerId: number | undefined
): DockAssignmentDecision {
  const available = compatibleDocks.filter((d) => d.occupantTrailerId == null);
  const occupied = compatibleDocks.filter((d) => d.occupantTrailerId != null);

  if (!requestedDockId) {
    if (available.length === 1) return { action: "auto", dockId: available[0].id };
    return { action: "needsSelection", available, occupied };
  }

  const chosen = compatibleDocks.find((d) => d.id === requestedDockId);
  if (!chosen) return { action: "invalid", error: "That dock isn't available for this trailer's equipment type" };

  if (chosen.occupantTrailerId == null) return { action: "move", dockId: chosen.id };

  if (confirmSwapWithTrailerId !== chosen.occupantTrailerId) {
    return {
      action: "needsSwapConfirmation",
      dockId: chosen.id,
      occupantTrailerId: chosen.occupantTrailerId,
      occupantPlate: chosen.occupantPlate || "",
    };
  }
  return { action: "swap", dockId: chosen.id, occupantTrailerId: chosen.occupantTrailerId };
}
