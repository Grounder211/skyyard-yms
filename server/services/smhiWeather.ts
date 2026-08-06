// Live current-conditions from SMHI's public METOBS observation API (no key needed).
// Verified live entry point: https://opendata-download-metobs.smhi.se/api.json
// Endpoint pattern confirmed working 2026-08-06:
//   /api/version/latest/parameter/1/station/{stationId}/period/latest-hour/data.json
// Parameter 1 = Lufttemperatur (air temperature, degrees C, hourly).
const SMHI_BASE = "https://opendata-download-metobs.smhi.se/api/version/latest/parameter/1";

// Fallback station: Stockholm-Bromma Flygplats (97200), a real active CORE station.
// Used only when the facility has no latitude/longitude set (facilities.latitude/
// longitude, added in the add_facility_coordinates migration) or SMHI_STATION_ID
// isn't set — otherwise the nearest active station to the facility is used.
const DEFAULT_STATION_ID = process.env.SMHI_STATION_ID || "97200";

interface WeatherReading {
  tempC: number;
  stationName: string;
  stationId: string;
  observedAt: string;
  icyRisk: boolean;
}

interface Station {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  active: boolean;
}

let readingCache: { data: WeatherReading; fetchedAt: number; key: string } | null = null;
const READING_CACHE_MS = 5 * 60 * 1000; // SMHI publishes hourly readings — 5min cache is plenty

let stationListCache: { stations: Station[]; fetchedAt: number } | null = null;
const STATION_LIST_CACHE_MS = 24 * 60 * 60 * 1000; // station roster changes rarely

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getStationList(): Promise<Station[]> {
  if (stationListCache && Date.now() - stationListCache.fetchedAt < STATION_LIST_CACHE_MS) {
    return stationListCache.stations;
  }
  const res = await fetch(`${SMHI_BASE}.json`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return stationListCache?.stations || [];
  const json: any = await res.json();
  const stations: Station[] = (json.station || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    latitude: s.latitude,
    longitude: s.longitude,
    active: !!s.active,
  }));
  stationListCache = { stations, fetchedAt: Date.now() };
  return stations;
}

async function findNearestStationId(lat: number, lon: number): Promise<string> {
  const stations = await getStationList();
  const active = stations.filter((s) => s.active);
  if (active.length === 0) return DEFAULT_STATION_ID;
  let nearest = active[0];
  let nearestDist = haversineKm(lat, lon, nearest.latitude, nearest.longitude);
  for (const s of active.slice(1)) {
    const d = haversineKm(lat, lon, s.latitude, s.longitude);
    if (d < nearestDist) {
      nearest = s;
      nearestDist = d;
    }
  }
  return String(nearest.id);
}

export async function getCurrentTemperature(coords?: { lat: number; lon: number }): Promise<WeatherReading | null> {
  const stationId = coords ? await findNearestStationId(coords.lat, coords.lon) : DEFAULT_STATION_ID;
  const cacheKey = stationId;

  if (readingCache && readingCache.key === cacheKey && Date.now() - readingCache.fetchedAt < READING_CACHE_MS) {
    return readingCache.data;
  }

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

  readingCache = { data: reading, fetchedAt: Date.now(), key: cacheKey };
  return reading;
}
