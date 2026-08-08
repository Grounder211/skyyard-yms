// vehicles.expiry_notified_at existed to dedupe a recurring notification job
// but nothing ever ran one — Needs Attention (Phase H) surfaces expiring
// inspections to staff who happen to look at the dashboard, but nothing
// proactively notifies the carrier who actually needs to renew it.

export function shouldNotifyExpiry(inspectionExpiry: string | null, expiryNotifiedAt: string | null, thresholdDays: number = 14, todayIso: string = new Date().toISOString().split("T")[0]): boolean {
  if (!inspectionExpiry) return false;
  if (expiryNotifiedAt) return false; // already notified for this expiry date — cleared when the date changes
  const threshold = new Date(todayIso);
  threshold.setDate(threshold.getDate() + thresholdDays);
  return inspectionExpiry <= threshold.toISOString().split("T")[0];
}
