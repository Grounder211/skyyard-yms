export interface DockApptWindow {
  id?: number;
  dock_id: number | null;
  start_time: string;
  end_time: string;
  status: string;
  load_type: string | null;
}

// Priority 22: two appointments, same dock, overlapping time, or an
// equipment type the dock doesn't accept (reuses the same
// dock_rules.allowed_equipment_types the move-time enforcement checks —
// one real rule, checked at both the point of booking and the point of
// actually moving a trailer there).
export function findDockConflict(
  candidate: { dock_id: number | null; start_time: string; end_time: string; load_type: string | null },
  existing: DockApptWindow[],
  allowedEquipmentTypes: string[] | null
): { reason: string } | null {
  if (candidate.dock_id == null) return null;

  if (allowedEquipmentTypes && candidate.load_type && !allowedEquipmentTypes.includes(candidate.load_type)) {
    return { reason: `Dock does not accept ${candidate.load_type} equipment` };
  }

  const candStart = new Date(candidate.start_time).getTime();
  const candEnd = new Date(candidate.end_time).getTime();

  for (const e of existing) {
    if (e.dock_id !== candidate.dock_id) continue;
    if (e.status === "CANCELLED" || e.status === "COMPLETED") continue;
    const eStart = new Date(e.start_time).getTime();
    const eEnd = new Date(e.end_time).getTime();
    if (candStart < eEnd && eStart < candEnd) {
      return { reason: `Dock already booked ${e.start_time}–${e.end_time}` };
    }
  }
  return null;
}
