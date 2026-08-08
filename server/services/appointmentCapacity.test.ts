import { describe, it, expect } from "vitest";
import { checkAppointmentCapacity, hourBucket } from "./appointmentCapacity.js";

describe("checkAppointmentCapacity", () => {
  const baseInput = {
    startTime: "2026-08-10T09:00:00.000Z",
    endTime: "2026-08-10T09:45:00.000Z",
    maxAppointmentsPerHour: null as number | null,
    appointmentsInSameHour: 0,
    blackouts: [],
  };

  it("allows when there is no cap and no blackout", () => {
    expect(checkAppointmentCapacity(baseInput)).toEqual({ allowed: true });
  });

  it("allows when under the hourly cap", () => {
    const result = checkAppointmentCapacity({ ...baseInput, maxAppointmentsPerHour: 4, appointmentsInSameHour: 3 });
    expect(result.allowed).toBe(true);
  });

  it("blocks once the hourly cap is reached", () => {
    const result = checkAppointmentCapacity({ ...baseInput, maxAppointmentsPerHour: 4, appointmentsInSameHour: 4 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/capacity reached \(4\/hour\)/);
  });

  it("blocks when the requested window overlaps a blackout", () => {
    const result = checkAppointmentCapacity({
      ...baseInput,
      blackouts: [{ start_time: "2026-08-10T08:00:00Z", end_time: "2026-08-10T10:00:00Z", reason: "Holiday closure" }],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Holiday closure/);
  });

  it("allows when the requested window is outside any blackout", () => {
    const result = checkAppointmentCapacity({
      ...baseInput,
      blackouts: [{ start_time: "2026-08-11T00:00:00Z", end_time: "2026-08-12T00:00:00Z", reason: "Next-day maintenance" }],
    });
    expect(result.allowed).toBe(true);
  });

  it("checks blackout before capacity so the more specific reason wins", () => {
    const result = checkAppointmentCapacity({
      ...baseInput,
      maxAppointmentsPerHour: 1,
      appointmentsInSameHour: 1,
      blackouts: [{ start_time: "2026-08-10T08:00:00Z", end_time: "2026-08-10T10:00:00Z", reason: "Storm closure" }],
    });
    expect(result.reason).toMatch(/Storm closure/);
  });
});

describe("hourBucket", () => {
  it("floors to the start of the clock hour and adds one hour for the end", () => {
    expect(hourBucket("2026-08-10T09:37:12.500Z")).toEqual({
      start: "2026-08-10T09:00:00.000Z",
      end: "2026-08-10T10:00:00.000Z",
    });
  });

  it("handles an on-the-hour timestamp", () => {
    expect(hourBucket("2026-08-10T14:00:00.000Z")).toEqual({
      start: "2026-08-10T14:00:00.000Z",
      end: "2026-08-10T15:00:00.000Z",
    });
  });
});
