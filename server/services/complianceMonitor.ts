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
