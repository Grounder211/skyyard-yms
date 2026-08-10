import { describe, it, expect } from "vitest";
import { predictArrival } from "./arrivalPrediction.js";

describe("predictArrival", () => {
  const nowIso = "2026-08-10T12:00:00.000Z";

  it("returns UNKNOWN when there is no traffic-aware route", () => {
    const result = predictArrival({ appointmentStartIso: "2026-08-10T13:00:00Z", gracePeriodMinutes: 30, trafficDurationSeconds: null, nowIso });
    expect(result.risk).toBe("UNKNOWN");
    expect(result.predictedArrivalIso).toBeNull();
  });

  it("is ON_TRACK when the traffic-aware ETA lands before the appointment", () => {
    // 30 min drive, appointment is 1 hour from now
    const result = predictArrival({ appointmentStartIso: "2026-08-10T13:00:00Z", gracePeriodMinutes: 30, trafficDurationSeconds: 1800, nowIso });
    expect(result.risk).toBe("ON_TRACK");
    expect(result.predictedArrivalIso).toBe("2026-08-10T12:30:00.000Z");
  });

  it("is AT_RISK when the ETA is past the appointment but within grace", () => {
    // appointment was 10 min ago, 15 min drive, 30 min grace
    const result = predictArrival({ appointmentStartIso: "2026-08-10T11:50:00Z", gracePeriodMinutes: 30, trafficDurationSeconds: 900, nowIso });
    expect(result.risk).toBe("AT_RISK");
  });

  it("is LATE when the ETA is past the appointment window plus grace", () => {
    const result = predictArrival({ appointmentStartIso: "2026-08-10T11:00:00Z", gracePeriodMinutes: 30, trafficDurationSeconds: 900, nowIso });
    expect(result.risk).toBe("LATE");
    expect(result.reason).toContain("past the appointment window");
  });

  it("defaults grace period to 30 minutes when null", () => {
    const result = predictArrival({ appointmentStartIso: "2026-08-10T11:00:00Z", gracePeriodMinutes: null, trafficDurationSeconds: 900, nowIso });
    expect(result.risk).toBe("LATE");
  });
});
