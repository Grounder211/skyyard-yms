// Every appointment slot was treated as a fixed, uniform block regardless of
// what's actually being loaded — a pallet of standard freight and a hazmat
// tanker both "took" one hour on the schedule. In reality a reefer or hazmat
// load takes meaningfully longer at the dock than a standard drop, and a
// heavy load takes longer than a light one. This estimates a realistic
// dock-occupied duration so the schedule can be duration-aware instead of
// pretending every appointment is the same length.

const BASE_MINUTES_BY_LOAD_TYPE: Record<string, number> = {
  standard: 45,
  flatbed: 60,
  reefer: 75,
  tanker: 90,
  hazmat: 90,
  oversized: 120,
};

const DEFAULT_MINUTES = 60;

export function estimateDurationMinutes(loadType?: string | null, loadWeightKg?: number | null): number {
  let minutes = BASE_MINUTES_BY_LOAD_TYPE[(loadType || "").toLowerCase()] ?? DEFAULT_MINUTES;

  // Heavy loads take longer to secure/unload — add 15 min per 10t over 20t,
  // capped so a data-entry typo (e.g. an extra zero) can't blow up the slot.
  if (loadWeightKg && loadWeightKg > 20000) {
    const extraTonnes = (loadWeightKg - 20000) / 1000;
    minutes += Math.min(60, Math.floor(extraTonnes / 10) * 15);
  }

  return minutes;
}

export function estimateEndTime(startTimeIso: string, loadType?: string | null, loadWeightKg?: number | null): string {
  const minutes = estimateDurationMinutes(loadType, loadWeightKg);
  return new Date(new Date(startTimeIso).getTime() + minutes * 60_000).toISOString();
}

export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}
