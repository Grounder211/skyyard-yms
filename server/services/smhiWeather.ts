// Live current-conditions from SMHI's public METOBS observation API (no key needed).
// Verified live entry point: https://opendata-download-metobs.smhi.se/api.json
// Endpoint pattern confirmed working 2026-08-06:
//   /api/version/latest/parameter/1/station/{stationId}/period/latest-hour/data.json
// Parameter 1 = Lufttemperatur (air temperature, degrees C, hourly).
const SMHI_BASE = "https://opendata-download-metobs.smhi.se/api/version/latest/parameter/1";

// Default station: Stockholm-Bromma Flygplats (97200), a real active CORE station.
// Override with SMHI_STATION_ID once the facility's actual nearest station is known
// (see /api/admin/facility-coords + station lookup, added separately).
const DEFAULT_STATION_ID = process.env.SMHI_STATION_ID || "97200";

interface WeatherReading {
  tempC: number;
  stationName: string;
  stationId: string;
  observedAt: string;
  icyRisk: boolean;
}

let cache: { data: WeatherReading; fetchedAt: number } | null = null;
const CACHE_MS = 5 * 60 * 1000; // SMHI publishes hourly readings — 5min cache is plenty

export async function getCurrentTemperature(stationId = DEFAULT_STATION_ID): Promise<WeatherReading | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.data;

  const res = await fetch(`${SMHI_BASE}/station/${stationId}/period/latest-hour/data.json`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;

  const json: any = await res.json();
  const latest = json.value?.[0];
  if (!latest) return null;

  const reading: WeatherReading = {
    tempC: parseFloat(latest.value),
    stationName: json.station?.name || "Unknown station",
    stationId: String(json.station?.key || stationId),
    observedAt: new Date(latest.date).toISOString(),
    icyRisk: parseFloat(latest.value) <= 2,
  };

  cache = { data: reading, fetchedAt: Date.now() };
  return reading;
}
