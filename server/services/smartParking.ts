export interface ParkedTrailer {
  trailerId: number;
  plate: string;
  spotId: number;
  spotName: string;
  zoneName: string | null;
}

export interface UpcomingDockAppointment {
  plate: string;
  dockSpotId: number;
  dockName: string;
  dockZoneName: string | null;
  startTime: string;
}

export interface EmptyParkingSpot {
  id: number;
  name: string;
  zoneName: string | null;
}

export interface ParkingRecommendation {
  trailerId: number;
  plate: string;
  currentSpotId: number;
  currentSpotName: string;
  recommendedSpotId: number;
  recommendedSpotName: string;
  reason: string;
  expectedBenefit: string;
}

// Priority 47: Smart Parking — a trailer parked outside the zone of its own
// next dock appointment can be repositioned closer before the hostler move
// actually happens, instead of a longer cross-zone haul later. Zone match
// (spots.zone_name) is the real signal available; no x/y geometry is
// tracked on spots, so a numeric distance is never invented here — see
// REAL DATA RULE. This only recommends: creating the move order still
// requires an admin/hostler to act on it (see /api/create-move).
export function recommendParkingMoves(
  parkedTrailers: ParkedTrailer[],
  upcomingAppointments: UpcomingDockAppointment[],
  emptyParkingSpots: EmptyParkingSpot[]
): ParkingRecommendation[] {
  const nextApptByPlate = new Map<string, UpcomingDockAppointment>();
  for (const appt of upcomingAppointments) {
    const existing = nextApptByPlate.get(appt.plate);
    if (!existing || new Date(appt.startTime) < new Date(existing.startTime)) {
      nextApptByPlate.set(appt.plate, appt);
    }
  }

  const recommendations: ParkingRecommendation[] = [];
  const claimedSpotIds = new Set<number>();

  for (const trailer of parkedTrailers) {
    const appt = nextApptByPlate.get(trailer.plate);
    if (!appt || appt.dockZoneName == null) continue;
    if (trailer.zoneName === appt.dockZoneName) continue; // already in the right zone

    const betterSpot = emptyParkingSpots.find(
      (s) => !claimedSpotIds.has(s.id) && s.id !== trailer.spotId && s.zoneName === appt.dockZoneName
    );
    if (!betterSpot) continue;

    claimedSpotIds.add(betterSpot.id);
    recommendations.push({
      trailerId: trailer.trailerId,
      plate: trailer.plate,
      currentSpotId: trailer.spotId,
      currentSpotName: trailer.spotName,
      recommendedSpotId: betterSpot.id,
      recommendedSpotName: betterSpot.name,
      reason: `Next dock is ${appt.dockName}, in zone ${appt.dockZoneName}. Currently in ${trailer.zoneName || "an unzoned spot"}.`,
      expectedBenefit: "Avoids a cross-zone hostler move when this trailer is dispatched to its dock",
    });
  }

  return recommendations;
}
