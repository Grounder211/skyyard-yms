export interface ForecastWindow {
  minutes: number;
  expectedOccupied: number;
  totalSpots: number;
  pct: number;
  atRisk: boolean;
}

// Priority 25: forecast occupancy from real scheduled arrivals and real
// scheduled departures — no historical model, no invented growth curve.
// Arrivals are SCHEDULED appointments starting inside the window;
// departures are trailers whose appointment end_time falls in the window.
// Deliberately simple and explainable; a learned model would need
// historical accuracy data this app doesn't collect yet.
export function forecastOccupancy(
  currentOccupied: number,
  totalSpots: number,
  arrivalsByWindow: number[],
  departuresByWindow: number[],
  windows: number[],
  riskThresholdPct: number
): ForecastWindow[] {
  return windows.map((minutes, i) => {
    const expectedOccupied = Math.max(0, Math.min(totalSpots, currentOccupied + (arrivalsByWindow[i] || 0) - (departuresByWindow[i] || 0)));
    const pct = totalSpots > 0 ? Math.round((expectedOccupied / totalSpots) * 100) : 0;
    return { minutes, expectedOccupied, totalSpots, pct, atRisk: pct >= riskThresholdPct };
  });
}
