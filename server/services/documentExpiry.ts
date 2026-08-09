// Priority-3 ask: configurable warning levels (30/14/7/3/1 days, then
// expired), deduplicated so the same document doesn't re-alert every time
// the cron runs. expiry_alert_level stores the smallest threshold already
// alerted at (0 = expired); a new alert only fires when the document has
// crossed into a *lower* level than what's stored, so tightening from
// "30 days out" to "7 days out" fires exactly once per crossing, not once
// per cron tick.

export const EXPIRY_ALERT_LEVELS = [30, 14, 7, 3, 1, 0] as const;

export function daysUntil(expiryDateIso: string, todayIso: string = new Date().toISOString().split("T")[0]): number {
  const ms = new Date(expiryDateIso + "T00:00:00Z").getTime() - new Date(todayIso + "T00:00:00Z").getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function nextExpiryAlertLevel(expiryDateIso: string, lastAlertedLevel: number | null, todayIso: string = new Date().toISOString().split("T")[0]): number | null {
  const days = daysUntil(expiryDateIso, todayIso);
  // Tightest (smallest) threshold that still covers the current days-
  // remaining — e.g. 10 days out matches both the 30-day and 14-day
  // levels, but the meaningful one to alert at is 14, the closer call.
  const ascending = [...EXPIRY_ALERT_LEVELS].sort((a, b) => a - b);
  const crossedLevel = ascending.find((level) => days <= level);
  if (crossedLevel === undefined) return null; // not within any threshold yet
  if (lastAlertedLevel !== null && crossedLevel >= lastAlertedLevel) return null; // already alerted at this level or a tighter one
  return crossedLevel;
}

// Priority-4: which of a facility's required doc types are missing for an
// entity, checked against its non-rejected/non-expired uploaded types.
export function missingDocumentTypes(required: string[], uploadedTypes: string[]): string[] {
  return required.filter((t) => !uploadedTypes.includes(t));
}
