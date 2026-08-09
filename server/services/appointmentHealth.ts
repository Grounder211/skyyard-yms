export type HealthStatus = "ON_TRACK" | "AT_RISK" | "LATE" | "NO_SHOW" | "BLOCKED";

export interface AppointmentHealthInput {
  status: string;
  start_time: string;
  no_show_flag: boolean | null;
  grace_period_minutes: number | null;
}

export function classifyAppointmentHealth(
  appt: AppointmentHealthInput,
  flags: { carrierFlagged: boolean; carrierBlacklisted: boolean },
  nowIso: string
): { status: HealthStatus; reason: string } {
  if (appt.no_show_flag) return { status: "NO_SHOW", reason: "Missed the grace period — marked no-show" };
  if (flags.carrierBlacklisted) return { status: "BLOCKED", reason: "Carrier is blacklisted at this facility" };
  if (appt.status === "CHECKED_IN" || appt.status === "COMPLETED") return { status: "ON_TRACK", reason: "Already checked in" };
  if (appt.status === "CANCELLED") return { status: "ON_TRACK", reason: "Cancelled" };

  const now = new Date(nowIso).getTime();
  const start = new Date(appt.start_time).getTime();
  const graceMs = (appt.grace_period_minutes ?? 30) * 60000;

  if (now > start + graceMs) return { status: "LATE", reason: "Past scheduled time and grace period, not yet checked in" };
  if (now > start) return { status: "AT_RISK", reason: "Past scheduled time, still within the grace period" };
  if (flags.carrierFlagged) return { status: "AT_RISK", reason: "Carrier is flagged for excessive no-shows" };
  return { status: "ON_TRACK", reason: "On schedule" };
}
