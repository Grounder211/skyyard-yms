// Trailers had a reefer_temp_setpoint column and "reefer" as a load type
// everywhere in the UI, but nothing ever recorded an actual temperature or
// fuel reading, and nothing ever alerted on one going bad. Real IoT sensor
// integration (telematics feeds pushing live readings) is hardware-dependent
// and out of scope here — this covers the same need without hardware: staff
// key in a temperature/fuel reading (at the gate, or any walk-by check),
// and it gets evaluated against the trailer's setpoint and flagged if it's
// out of range, low on fuel, or hasn't been checked in too long.

export type ReeferStatus = "ok" | "warning" | "critical";

export interface ReeferEvaluation {
  status: ReeferStatus;
  reasons: string[];
}

const DEFAULT_MIN_C = -25;
const DEFAULT_MAX_C = 8;
const SETPOINT_WARNING_DEVIATION_C = 2;
const SETPOINT_CRITICAL_DEVIATION_C = 5;
const FUEL_WARNING_PCT = 25;
const FUEL_CRITICAL_PCT = 10;
export const STALE_READING_HOURS = 4;

export function evaluateReading(temperatureC: number, fuelLevelPct?: number | null, setpointC?: number | null): ReeferEvaluation {
  const reasons: string[] = [];
  let status: ReeferStatus = "ok";

  const bump = (next: ReeferStatus) => {
    if (next === "critical" || status === "ok") status = next;
  };

  if (setpointC != null) {
    const deviation = Math.abs(temperatureC - setpointC);
    if (deviation >= SETPOINT_CRITICAL_DEVIATION_C) {
      bump("critical");
      reasons.push(`${temperatureC}°C is ${deviation.toFixed(1)}°C off the ${setpointC}°C setpoint`);
    } else if (deviation >= SETPOINT_WARNING_DEVIATION_C) {
      bump("warning");
      reasons.push(`${temperatureC}°C is drifting from the ${setpointC}°C setpoint`);
    }
  } else if (temperatureC < DEFAULT_MIN_C || temperatureC > DEFAULT_MAX_C) {
    bump("critical");
    reasons.push(`${temperatureC}°C is outside the safe reefer range (${DEFAULT_MIN_C}°C to ${DEFAULT_MAX_C}°C)`);
  }

  if (fuelLevelPct != null) {
    if (fuelLevelPct <= FUEL_CRITICAL_PCT) {
      bump("critical");
      reasons.push(`Fuel at ${fuelLevelPct}% — critically low`);
    } else if (fuelLevelPct <= FUEL_WARNING_PCT) {
      bump("warning");
      reasons.push(`Fuel at ${fuelLevelPct}% — running low`);
    }
  }

  return { status, reasons };
}

export function isReadingStale(recordedAtIso: string, nowIso: string = new Date().toISOString(), thresholdHours: number = STALE_READING_HOURS): boolean {
  const ageMs = new Date(nowIso).getTime() - new Date(recordedAtIso).getTime();
  return ageMs > thresholdHours * 60 * 60 * 1000;
}
