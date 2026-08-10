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

// Sourced from real yard-manager research: "carrier drops a trailer,
// nobody tells the warehouse" and "trailers sit past a dwell threshold
// with nobody noticing" are both independently documented pains, both
// solvable with data this app already has — no new table, no GPS. A
// trailer is unmanaged when it's sat past the threshold with no move
// order working it and no exception already tracking it (avoids
// double-signaling something already visible elsewhere).
export function findUnmanagedTrailers(
  spots: { id: number; name: string; trailer_id: number | undefined; plate: string | undefined; checked_in_at: string | undefined }[],
  moves: { trailer_id: number; status: string }[],
  openExceptionPlates: string[],
  nowIso: string,
  thresholdHours = 2
): { spotId: number; spotName: string; plate: string; dwellHours: number }[] {
  const activeTrailerIds = new Set(
    moves.filter((m) => m.status === "PENDING" || m.status === "IN_PROGRESS").map((m) => m.trailer_id)
  );
  const flaggedPlates = new Set(openExceptionPlates);
  const now = new Date(nowIso).getTime();

  return spots
    .filter((s) => s.trailer_id != null && s.plate && s.checked_in_at && !activeTrailerIds.has(s.trailer_id) && !flaggedPlates.has(s.plate))
    .map((s) => ({ spotId: s.id, spotName: s.name, plate: s.plate!, dwellHours: Math.round(((now - new Date(s.checked_in_at!).getTime()) / 3600000) * 10) / 10 }))
    .filter((s) => s.dwellHours >= thresholdHours);
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
