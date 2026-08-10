export type ArrivalRisk = "ON_TRACK" | "AT_RISK" | "LATE" | "UNKNOWN";

export interface ArrivalPredictionInput {
  appointmentStartIso: string;
  gracePeriodMinutes: number | null;
  trafficDurationSeconds: number | null; // null when no route is available — never fabricated
  nowIso: string;
}

export interface ArrivalPrediction {
  predictedArrivalIso: string | null;
  risk: ArrivalRisk;
  reason: string;
}

// Priority 2: Arrival Intelligence — predicted arrival is "leave now, drive
// the traffic-aware duration", compared against the appointment window.
// This is deliberately not a learned model (see Phase 4's own "transparent
// logic, no fake precision" rule) — it's the same real Mapbox duration
// already shown on /api/traffic/route, just projected onto a clock.
export function predictArrival(input: ArrivalPredictionInput): ArrivalPrediction {
  if (input.trafficDurationSeconds == null) {
    return { predictedArrivalIso: null, risk: "UNKNOWN", reason: "No traffic-aware route available for this appointment's origin" };
  }

  const now = new Date(input.nowIso).getTime();
  const predicted = now + input.trafficDurationSeconds * 1000;
  const start = new Date(input.appointmentStartIso).getTime();
  const graceMs = (input.gracePeriodMinutes ?? 30) * 60000;
  const deltaMinutes = Math.round((predicted - start) / 60000);
  const predictedArrivalIso = new Date(predicted).toISOString();

  if (predicted > start + graceMs) {
    return { predictedArrivalIso, risk: "LATE", reason: `Traffic-aware ETA is ${deltaMinutes} minutes past the appointment window` };
  }
  if (predicted > start) {
    return { predictedArrivalIso, risk: "AT_RISK", reason: `Traffic-aware ETA is ${deltaMinutes} minutes after the scheduled time, within the grace period` };
  }
  return { predictedArrivalIso, risk: "ON_TRACK", reason: "Traffic-aware ETA arrives on or before the scheduled time" };
}
