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
