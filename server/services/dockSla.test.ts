import { describe, it, expect } from "vitest";
import { isDockSlaBreached } from "./dockSla.js";

describe("isDockSlaBreached", () => {
  const now = "2026-08-09T12:00:00Z";

  it("breaches once minutes-in-stage reaches the SLA", () => {
    expect(isDockSlaBreached("LOADING", "2026-08-09T11:00:00Z", 60, now)).toBe(true);
    expect(isDockSlaBreached("UNLOADING", "2026-08-09T11:00:00Z", 60, now)).toBe(true);
  });

  it("does not breach before the SLA", () => {
    expect(isDockSlaBreached("LOADING", "2026-08-09T11:30:00Z", 60, now)).toBe(false);
  });

  it("ignores stages that aren't dock operations", () => {
    expect(isDockSlaBreached("PARKED", "2026-08-09T00:00:00Z", 60, now)).toBe(false);
    expect(isDockSlaBreached("READY_FOR_EXIT", "2026-08-09T00:00:00Z", 60, now)).toBe(false);
  });
});
