// Provider-neutral traffic abstraction. The core app calls TrafficProvider,
// never Mapbox/Google directly — swapping providers means swapping the
// factory's return value, nothing else. No credential exists in this
// environment yet (checked at import time, not guessed), so getTrafficProvider()
// returns null until TRAFFIC_PROVIDER + the matching API key are both set.
// Never fabricate a route/ETA when unconfigured — callers must handle null.

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface TrafficAwareRoute {
  distanceMeters: number;
  normalDurationSeconds: number;
  trafficDurationSeconds: number;
  delaySeconds: number;
  provider: string;
  fetchedAt: string;
}

export interface TrafficProvider {
  readonly name: string;
  getTrafficAwareRoute(origin: RoutePoint, destination: RoutePoint): Promise<TrafficAwareRoute | null>;
  // Optional: forward-geocode a free-text address into a route point, so a
  // carrier-supplied origin address can feed getTrafficAwareRoute without
  // ever inventing coordinates. Not every provider needs to implement this.
  geocodeAddress?(address: string): Promise<RoutePoint | null>;
}

const cache = new Map<string, { at: number; value: TrafficAwareRoute | null }>();
const CACHE_MS = 2 * 60 * 1000; // real traffic doesn't need per-request freshness
const cacheKey = (o: RoutePoint, d: RoutePoint) => `${o.lat},${o.lng}->${d.lat},${d.lng}`;

async function withCache(o: RoutePoint, d: RoutePoint, fn: () => Promise<TrafficAwareRoute | null>): Promise<TrafficAwareRoute | null> {
  const key = cacheKey(o, d);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export class MapboxTrafficProvider implements TrafficProvider {
  readonly name = "mapbox";
  constructor(private token: string) {}

  async getTrafficAwareRoute(origin: RoutePoint, destination: RoutePoint): Promise<TrafficAwareRoute | null> {
    return withCache(origin, destination, async () => {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?access_token=${this.token}&overview=false`;
      // Live-verified round trips to Mapbox from this deployment ran as
      // high as ~13s under real network conditions — 5s was cutting off
      // good responses as timeouts, not just failing fast on dead ones.
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Mapbox Directions API returned ${res.status}`);
      const data = await res.json();
      const route = data?.routes?.[0];
      if (!route) return null;
      // Mapbox's traffic-aware `duration` already reflects current conditions;
      // `duration_typical` is the same route under typical (non-live) conditions.
      const trafficDuration = route.duration;
      const normalDuration = route.duration_typical ?? route.duration;
      return {
        distanceMeters: Math.round(route.distance),
        normalDurationSeconds: Math.round(normalDuration),
        trafficDurationSeconds: Math.round(trafficDuration),
        delaySeconds: Math.round(trafficDuration - normalDuration),
        provider: "mapbox",
        fetchedAt: new Date().toISOString(),
      };
    });
  }

  async geocodeAddress(address: string): Promise<RoutePoint | null> {
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(address)}&limit=1&access_token=${this.token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Mapbox Geocoding API returned ${res.status}`);
    const data = await res.json();
    const [lng, lat] = data?.features?.[0]?.geometry?.coordinates || [];
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
  }
}

let cachedProvider: TrafficProvider | null | undefined;

export function getTrafficProvider(): TrafficProvider | null {
  if (cachedProvider !== undefined) return cachedProvider;
  const configured = process.env.TRAFFIC_PROVIDER;
  if (configured === "mapbox" && process.env.MAPBOX_ACCESS_TOKEN) {
    cachedProvider = new MapboxTrafficProvider(process.env.MAPBOX_ACCESS_TOKEN);
  } else {
    cachedProvider = null;
  }
  return cachedProvider;
}

// Test-only: clears the memoized provider so a test can flip env vars and
// re-resolve. Never called from application code.
export function _resetTrafficProviderCache() {
  cachedProvider = undefined;
}
