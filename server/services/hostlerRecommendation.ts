export interface HostlerCandidate {
  id: number;
  name: string;
  onShift: boolean;
}

export interface HostlerRecommendation extends HostlerCandidate {
  activeMoveCount: number;
  recommended: boolean;
  reason: string;
}

// Priority 46: Hostler Intelligence — rank hostlers for a new move by real
// current workload instead of a plain alphabetical dropdown. Distance/
// location scoring needs GPS, which is NOT_CONFIGURED (see
// /api/admin/integrations) — never fabricate that signal. Workload (active
// IN_PROGRESS move_orders) and on-shift status are both real, already-
// tracked data, so that's what this scores on. Off-shift hostlers are
// never marked recommended but stay listed — an admin may know something
// the data doesn't and can still assign one by hand.
export function rankHostlersByWorkload(
  hostlers: HostlerCandidate[],
  activeMoves: { assigned_to: number | null }[]
): HostlerRecommendation[] {
  const workload = new Map<number, number>();
  for (const m of activeMoves) {
    if (m.assigned_to == null) continue;
    workload.set(m.assigned_to, (workload.get(m.assigned_to) || 0) + 1);
  }

  const ranked: HostlerRecommendation[] = hostlers.map((h) => {
    const activeMoveCount = workload.get(h.id) || 0;
    const reason = !h.onShift
      ? "Off shift"
      : activeMoveCount === 0
      ? "On shift, no active moves"
      : `On shift, ${activeMoveCount} active move${activeMoveCount === 1 ? "" : "s"}`;
    return { ...h, activeMoveCount, recommended: false, reason };
  });

  ranked.sort((a, b) => {
    if (a.onShift !== b.onShift) return a.onShift ? -1 : 1;
    return a.activeMoveCount - b.activeMoveCount;
  });

  const top = ranked.find((h) => h.onShift);
  if (top) top.recommended = true;

  return ranked;
}
