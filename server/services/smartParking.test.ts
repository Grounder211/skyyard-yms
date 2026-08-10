import { describe, it, expect } from "vitest";
import { recommendParkingMoves } from "./smartParking.js";

describe("recommendParkingMoves", () => {
  it("recommends moving a trailer into the zone of its next dock appointment", () => {
    const parked = [{ trailerId: 1, plate: "T182", spotId: 31, spotName: "P31", zoneName: "A" }];
    const appts = [{ plate: "T182", dockSpotId: 7, dockName: "D7", dockZoneName: "B", startTime: "2026-08-10T14:00:00Z" }];
    const empty = [{ id: 14, name: "P14", zoneName: "B" }];
    const recs = recommendParkingMoves(parked, appts, empty);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ trailerId: 1, plate: "T182", currentSpotName: "P31", recommendedSpotName: "P14" });
    expect(recs[0].reason).toContain("D7");
  });

  it("does not recommend a move when the trailer is already in the right zone", () => {
    const parked = [{ trailerId: 1, plate: "T182", spotId: 31, spotName: "P31", zoneName: "B" }];
    const appts = [{ plate: "T182", dockSpotId: 7, dockName: "D7", dockZoneName: "B", startTime: "2026-08-10T14:00:00Z" }];
    const empty = [{ id: 14, name: "P14", zoneName: "B" }];
    expect(recommendParkingMoves(parked, appts, empty)).toEqual([]);
  });

  it("skips a trailer with no upcoming appointment", () => {
    const parked = [{ trailerId: 1, plate: "T182", spotId: 31, spotName: "P31", zoneName: "A" }];
    expect(recommendParkingMoves(parked, [], [{ id: 14, name: "P14", zoneName: "B" }])).toEqual([]);
  });

  it("skips when no empty spot exists in the target zone", () => {
    const parked = [{ trailerId: 1, plate: "T182", spotId: 31, spotName: "P31", zoneName: "A" }];
    const appts = [{ plate: "T182", dockSpotId: 7, dockName: "D7", dockZoneName: "B", startTime: "2026-08-10T14:00:00Z" }];
    const empty = [{ id: 20, name: "P20", zoneName: "C" }];
    expect(recommendParkingMoves(parked, appts, empty)).toEqual([]);
  });

  it("picks the earliest appointment when a plate has more than one, and never double-books a target spot", () => {
    const parked = [
      { trailerId: 1, plate: "T182", spotId: 31, spotName: "P31", zoneName: "A" },
      { trailerId: 2, plate: "T200", spotId: 32, spotName: "P32", zoneName: "A" },
    ];
    const appts = [
      { plate: "T182", dockSpotId: 9, dockName: "D9", dockZoneName: "B", startTime: "2026-08-10T18:00:00Z" },
      { plate: "T182", dockSpotId: 7, dockName: "D7", dockZoneName: "B", startTime: "2026-08-10T14:00:00Z" },
      { plate: "T200", dockSpotId: 7, dockName: "D7", dockZoneName: "B", startTime: "2026-08-10T15:00:00Z" },
    ];
    const empty = [{ id: 14, name: "P14", zoneName: "B" }];
    const recs = recommendParkingMoves(parked, appts, empty);
    expect(recs).toHaveLength(1);
    expect(recs[0].plate).toBe("T182");
    expect(recs[0].reason).toContain("D7");
  });
});
