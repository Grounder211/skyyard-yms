import { describe, it, expect } from "vitest";
import { countTodayNoShows, countExpectedArrivalsToday, countBusyHostlers, summarizeZoneOccupancy } from "./todayOps.js";

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

describe("countBusyHostlers", () => {
  it("counts distinct hostlers with an IN_PROGRESS move", () => {
    const moves = [
      { status: "IN_PROGRESS", assigned_to: 1 },
      { status: "IN_PROGRESS", assigned_to: 2 },
      { status: "PENDING", assigned_to: null },
    ];
    expect(countBusyHostlers(moves)).toBe(2);
  });

  it("counts one hostler once even with multiple IN_PROGRESS moves", () => {
    const moves = [
      { status: "IN_PROGRESS", assigned_to: 1 },
      { status: "IN_PROGRESS", assigned_to: 1 },
    ];
    expect(countBusyHostlers(moves)).toBe(1);
  });

  it("returns 0 when nothing is in progress", () => {
    expect(countBusyHostlers([{ status: "PENDING", assigned_to: null }])).toBe(0);
  });
});

describe("summarizeZoneOccupancy", () => {
  it("groups spots by zone and counts occupied vs total", () => {
    const spots = [
      { zone_name: "Yard Zone 1", status: "OCCUPIED" },
      { zone_name: "Yard Zone 1", status: "EMPTY" },
      { zone_name: "Dock Row A", status: "OCCUPIED" },
    ];
    expect(summarizeZoneOccupancy(spots)).toEqual([
      { zone: "Dock Row A", total: 1, occupied: 1 },
      { zone: "Yard Zone 1", total: 2, occupied: 1 },
    ]);
  });

  it("buckets spots with no zone under Unzoned", () => {
    expect(summarizeZoneOccupancy([{ zone_name: null, status: "EMPTY" }])).toEqual([
      { zone: "Unzoned", total: 1, occupied: 0 },
    ]);
  });

  it("returns an empty array for no spots", () => {
    expect(summarizeZoneOccupancy([])).toEqual([]);
  });
});
