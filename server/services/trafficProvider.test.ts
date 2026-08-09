import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTrafficProvider, MapboxTrafficProvider, _resetTrafficProviderCache } from "./trafficProvider.js";

describe("getTrafficProvider", () => {
  const original = { TRAFFIC_PROVIDER: process.env.TRAFFIC_PROVIDER, MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN };

  beforeEach(() => {
    _resetTrafficProviderCache();
  });

  afterEach(() => {
    process.env.TRAFFIC_PROVIDER = original.TRAFFIC_PROVIDER;
    process.env.MAPBOX_ACCESS_TOKEN = original.MAPBOX_ACCESS_TOKEN;
    _resetTrafficProviderCache();
  });

  it("returns null when no provider is configured", () => {
    delete process.env.TRAFFIC_PROVIDER;
    delete process.env.MAPBOX_ACCESS_TOKEN;
    expect(getTrafficProvider()).toBeNull();
  });

  it("returns null when TRAFFIC_PROVIDER is set but the matching key is missing", () => {
    process.env.TRAFFIC_PROVIDER = "mapbox";
    delete process.env.MAPBOX_ACCESS_TOKEN;
    expect(getTrafficProvider()).toBeNull();
  });

  it("returns a MapboxTrafficProvider when both are configured", () => {
    process.env.TRAFFIC_PROVIDER = "mapbox";
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    const provider = getTrafficProvider();
    expect(provider).toBeInstanceOf(MapboxTrafficProvider);
    expect(provider?.name).toBe("mapbox");
  });

  it("memoizes the resolved provider until reset", () => {
    delete process.env.TRAFFIC_PROVIDER;
    delete process.env.MAPBOX_ACCESS_TOKEN;
    expect(getTrafficProvider()).toBeNull();
    process.env.TRAFFIC_PROVIDER = "mapbox";
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    expect(getTrafficProvider()).toBeNull(); // still memoized, not re-read
  });
});
