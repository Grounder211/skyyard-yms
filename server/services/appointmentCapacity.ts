// Appointment creation (both staff-entered and carrier self-service booking)
// had no capacity enforcement at all — any number of trucks could be booked
// into the same hour with no cap, and there was no way to block out a
// maintenance window or holiday. This is the pure decision logic for both
// checks, kept separate from the DB/session plumbing in server.ts so it's
// testable without a live database.

import { intervalsOverlap } from "./appointmentDuration.js";

export interface Blackout {
  start_time: string;
  end_time: string;
  reason: string;
}

export interface CapacityCheckInput {
  startTime: string;
  endTime: string;
  maxAppointmentsPerHour: number | null;
  appointmentsInSameHour: number;
  blackouts: Blackout[];
}

export interface CapacityCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkAppointmentCapacity(input: CapacityCheckInput): CapacityCheckResult {
  const { startTime, endTime, maxAppointmentsPerHour, appointmentsInSameHour, blackouts } = input;

  for (const b of blackouts) {
    if (intervalsOverlap(startTime, endTime, b.start_time, b.end_time)) {
      return { allowed: false, reason: `Yard closed for this window: ${b.reason}` };
    }
  }

  if (maxAppointmentsPerHour != null && appointmentsInSameHour >= maxAppointmentsPerHour) {
    return { allowed: false, reason: `Hourly appointment capacity reached (${maxAppointmentsPerHour}/hour). Choose another time.` };
  }

  return { allowed: true };
}

// Clock-hour bucket (not a rolling 60min window) so "capacity per hour"
// means what a yard manager configuring it would expect: 09:00-10:00, not
// an arbitrary sliding window anchored to the requested time.
export function hourBucket(iso: string): { start: string; end: string } {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  const start = d.toISOString();
  const end = new Date(d.getTime() + 60 * 60_000).toISOString();
  return { start, end };
}
