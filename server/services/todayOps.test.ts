import { describe, it, expect } from "vitest";
import { countTodayNoShows, countExpectedArrivalsToday } from "./todayOps.js";

describe("countTodayNoShows", () => {
  const todayStart = "2026-08-09T00:00:00.000Z";

  it("counts only no-shows with start_time today", () => {
    const appts = [
      { no_show_flag: true, start_time: "2026-08-09T08:00:00Z" },
      { no_show_flag: true, start_time: "2026-08-08T08:00:00Z" },
      { no_show_flag: false, start_time: "2026-08-09T09:00:00Z" },
    ];
    expect(countTodayNoShows(appts, todayStart)).toBe(1);
  });

  it("returns 0 when there are none", () => {
    expect(countTodayNoShows([], todayStart)).toBe(0);
  });
});

describe("countExpectedArrivalsToday", () => {
  const todayStart = "2026-08-09T00:00:00.000Z";
  const todayEnd = "2026-08-10T00:00:00.000Z";

  it("counts only SCHEDULED appointments starting today", () => {
    const appts = [
      { status: "SCHEDULED", start_time: "2026-08-09T14:00:00Z" },
      { status: "SCHEDULED", start_time: "2026-08-10T01:00:00Z" },
      { status: "no_show", start_time: "2026-08-09T10:00:00Z" },
      { status: "SCHEDULED", start_time: "2026-08-08T23:00:00Z" },
    ];
    expect(countExpectedArrivalsToday(appts, todayStart, todayEnd)).toBe(1);
  });

  it("returns 0 for an empty list", () => {
    expect(countExpectedArrivalsToday([], todayStart, todayEnd)).toBe(0);
  });
});
