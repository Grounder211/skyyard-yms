export function countTodayNoShows(
  appointments: { no_show_flag: boolean; start_time: string }[],
  todayStartIso: string
): number {
  const todayStart = new Date(todayStartIso).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  return appointments.filter((a) => {
    if (!a.no_show_flag) return false;
    const t = new Date(a.start_time).getTime();
    return t >= todayStart && t < todayEnd;
  }).length;
}

export function summarizeZoneOccupancy(
  spots: { zone_name: string | null; status: string }[]
): { zone: string; total: number; occupied: number }[] {
  const byZone = new Map<string, { zone: string; total: number; occupied: number }>();
  for (const s of spots) {
    const zone = s.zone_name || "Unzoned";
    if (!byZone.has(zone)) byZone.set(zone, { zone, total: 0, occupied: 0 });
    const entry = byZone.get(zone)!;
    entry.total++;
    if (s.status === "OCCUPIED") entry.occupied++;
  }
  return Array.from(byZone.values()).sort((a, b) => a.zone.localeCompare(b.zone));
}

// Digital twin, minimal slice: exceptions already link to a trailer via
// entity_type="TRAILER" + entity_id=plate (used by blacklist/seal/reefer
// exceptions alike) — no new schema needed to plot them on the spot the
// trailer is actually sitting in.
export function matchExceptionPlatesToSpotIds(
  openExceptionPlates: string[],
  spots: { id: number; plate: string | null }[]
): number[] {
  const plateSet = new Set(openExceptionPlates);
  return spots.filter((s) => s.plate && plateSet.has(s.plate)).map((s) => s.id);
}

export function countBusyHostlers(moves: { status: string; assigned_to: number | null }[]): number {
  const busy = new Set(
    moves.filter((m) => m.status === "IN_PROGRESS" && m.assigned_to != null).map((m) => m.assigned_to)
  );
  return busy.size;
}

export function countExpectedArrivalsToday(
  appointments: { status: string; start_time: string }[],
  todayStartIso: string,
  todayEndIso: string
): number {
  const start = new Date(todayStartIso).getTime();
  const end = new Date(todayEndIso).getTime();
  return appointments.filter((a) => {
    if (a.status !== "SCHEDULED") return false;
    const t = new Date(a.start_time).getTime();
    return t >= start && t < end;
  }).length;
}
