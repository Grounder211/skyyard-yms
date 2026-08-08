// Pulled out of the SLA-tracking and no-show-detection cron workers so the
// threshold math is unit-testable without waiting on a real cron tick.

export type SlaLevel = "ok" | "warning" | "breach" | "critical";

export function evaluateSla(elapsedMinutes: number, thresholdMinutes: number, warningPct: number, escalationPct: number, criticalPct: number): SlaLevel {
  const pct = (elapsedMinutes / thresholdMinutes) * 100;
  if (pct >= criticalPct) return "critical";
  if (pct >= escalationPct) return "breach";
  if (pct >= warningPct) return "warning";
  return "ok";
}

export function isNoShow(startTimeIso: string, gracePeriodMinutes: number | null | undefined, nowIso: string = new Date().toISOString()): boolean {
  const grace = gracePeriodMinutes ?? 60;
  const elapsedMin = (new Date(nowIso).getTime() - new Date(startTimeIso).getTime()) / 60000;
  return elapsedMin >= grace;
}

// The carrier portal only ever showed a live count of active trucks and
// today's appointments — nothing about how that carrier actually performs
// against their scheduled slots, despite start_time/checked_in_at/
// grace_period_minutes/no_show_flag already existing on every appointment
// row. "On time" mirrors isNoShow's own grace-period definition rather than
// inventing a separate threshold: checked in at or before start_time plus
// the appointment's own grace period.
export function isOnTimeArrival(startTimeIso: string, checkedInAtIso: string, gracePeriodMinutes: number | null | undefined): boolean {
  const grace = gracePeriodMinutes ?? 60;
  const lateByMin = (new Date(checkedInAtIso).getTime() - new Date(startTimeIso).getTime()) / 60000;
  return lateByMin <= grace;
}
