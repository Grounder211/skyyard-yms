import { describe, it, expect } from "vitest";
import { classifyAppointmentHealth } from "./appointmentHealth.js";

const now = "2026-08-09T14:00:00.000Z";
const noFlags = { carrierFlagged: false, carrierBlacklisted: false };

describe("classifyAppointmentHealth", () => {
  it("is NO_SHOW when the no-show flag is set, regardless of anything else", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T10:00:00.000Z", no_show_flag: true, grace_period_minutes: 30 },
      noFlags, now
    );
    expect(r.status).toBe("NO_SHOW");
  });

  it("is BLOCKED when the carrier is blacklisted, even before no-show/lateness applies", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T15:00:00.000Z", no_show_flag: false, grace_period_minutes: 30 },
      { carrierFlagged: false, carrierBlacklisted: true }, now
    );
    expect(r.status).toBe("BLOCKED");
  });

  it("is ON_TRACK once checked in, even past the appointment time", () => {
    const r = classifyAppointmentHealth(
      { status: "CHECKED_IN", start_time: "2026-08-09T10:00:00.000Z", no_show_flag: false, grace_period_minutes: 30 },
      noFlags, now
    );
    expect(r.status).toBe("ON_TRACK");
  });

  it("is LATE once past start time plus grace period, not yet checked in", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T13:00:00.000Z", no_show_flag: false, grace_period_minutes: 30 },
      noFlags, now
    );
    expect(r.status).toBe("LATE");
  });

  it("is AT_RISK when past start time but still within the grace period", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T13:45:00.000Z", no_show_flag: false, grace_period_minutes: 30 },
      noFlags, now
    );
    expect(r.status).toBe("AT_RISK");
  });

  it("is AT_RISK ahead of time when the carrier is flagged for no-shows", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T16:00:00.000Z", no_show_flag: false, grace_period_minutes: 30 },
      { carrierFlagged: true, carrierBlacklisted: false }, now
    );
    expect(r.status).toBe("AT_RISK");
  });

  it("is ON_TRACK ahead of time with no risk signals", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T16:00:00.000Z", no_show_flag: false, grace_period_minutes: 30 },
      noFlags, now
    );
    expect(r.status).toBe("ON_TRACK");
  });

  it("defaults grace period to 30 minutes when not set", () => {
    const r = classifyAppointmentHealth(
      { status: "SCHEDULED", start_time: "2026-08-09T13:35:00.000Z", no_show_flag: false, grace_period_minutes: null },
      noFlags, now
    );
    expect(r.status).toBe("AT_RISK");
  });
});
