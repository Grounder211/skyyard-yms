export type HealthStatus = "ON_TRACK" | "AT_RISK" | "LATE" | "NO_SHOW" | "BLOCKED";

export interface AppointmentHealthInput {
  status: string;
  start_time: string;
  no_show_flag: boolean | null;
  grace_period_minutes: number | null;
}

// Priority 4: fold real gate-queue pressure into the risk read — a truck
// that's genuinely on schedule can still miss its window if the gate
// itself is backed up. GATE_QUEUE_RISK_THRESHOLD/WINDOW are static, not
// learned — Phase 4's own rule is "transparent logic, no fake precision".
const GATE_QUEUE_RISK_THRESHOLD = 5;
const GATE_QUEUE_RISK_WINDOW_MINUTES = 30;

export function classifyAppointmentHealth(
  appt: AppointmentHealthInput,
  flags: { carrierFlagged: boolean; carrierBlacklisted: boolean },
  nowIso: string,
  context?: { gateQueueDepth?: number }
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

  const minutesUntilStart = (start - now) / 60000;
  const queueDepth = context?.gateQueueDepth ?? 0;
  if (queueDepth >= GATE_QUEUE_RISK_THRESHOLD && minutesUntilStart <= GATE_QUEUE_RISK_WINDOW_MINUTES) {
    return { status: "AT_RISK", reason: `Gate queue is ${queueDepth} vehicles deep — processing delay likely even for an on-time arrival` };
  }

  if (flags.carrierFlagged) return { status: "AT_RISK", reason: "Carrier is flagged for excessive no-shows" };
  return { status: "ON_TRACK", reason: "On schedule" };
}
