import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

export interface YardMapSpot {
  id: number;
  name: string;
  type: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  plate?: string | null;
  carrier?: string | null;
  zone_name?: string | null;
  checked_in_at?: string | null;
  check_in_time?: string | null;
  detention_flag?: boolean | null;
}

export interface YardMapFacility {
  name: string;
  latitude: number;
  longitude: number;
  configured: boolean;
}

interface YardMapProps {
  spots: YardMapSpot[];
  facility: YardMapFacility;
  unresolvedSafetySpotIds?: number[];
  spotsWithOpenExceptions?: number[];
  onSelectSpot?: (spot: YardMapSpot) => void;
  height?: string;
  className?: string;
}

type MarkerState = "available" | "occupied" | "delayed" | "alert" | "maintenance";

// "reserved" isn't derivable yet — would need a spot-to-next-appointment
// join this component doesn't have — so it's not in this map. Never fake
// a state with no real signal behind it.
const STATE_COLOR: Record<MarkerState, string> = {
  available: "#94a3b8",
  occupied: "#4f46e5",
  delayed: "#f59e0b",
  alert: "#dc2626",
  maintenance: "#78716c",
};

function markerState(spot: YardMapSpot, alertIds: Set<number>): MarkerState {
  if (spot.status === "MAINTENANCE") return "maintenance";
  if (alertIds.has(spot.id)) return "alert";
  if (spot.plate && spot.detention_flag) return "delayed";
  if (spot.plate) return "occupied";
  return "available";
}

function dwellLabel(spot: YardMapSpot): string | null {
  const since = spot.checked_in_at || spot.check_in_time;
  if (!since) return null;
  const mins = Math.round((Date.now() - new Date(since).getTime()) / 60000);
  return mins < 60 ? `${mins}m on site` : `${Math.floor(mins / 60)}h ${mins % 60}m on site`;
}

// Real GPS is out of scope (no provider — see /api/admin/integrations).
// But a trailer's spot DOES really change the moment a move order
// completes, and that arrives over the same Socket.io "yard_update" /
// "move_update" events every page already listens to and re-fetches
// /api/yard-status on. This animates the truck marker from its last known
// spot to its new one over `durationMs` — an honest visualization of a
// real, already-happened state change, not a simulated live trajectory.
function animateMarkerTo(marker: mapboxgl.Marker, from: [number, number], to: [number, number], durationMs = 1200) {
  const start = performance.now();
  function tick(now: number) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    marker.setLngLat([from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased]);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function buildPopupNode(spot: YardMapSpot): HTMLElement {
  const el = document.createElement("div");
  el.className = "yard-map-popup";

  const title = document.createElement("div");
  title.style.cssText = "font-weight:700;font-size:13px;";
  title.textContent = spot.name;
  el.appendChild(title);

  const sub = document.createElement("div");
  sub.style.cssText = "font-size:11px;color:#64748b;margin-top:2px;";
  sub.textContent = `${spot.type === "DOCK" ? "Dock" : "Parking"}${spot.zone_name ? " · " + spot.zone_name : ""}`;
  el.appendChild(sub);

  if (spot.plate) {
    const plateRow = document.createElement("div");
    plateRow.style.cssText = "margin-top:6px;font-size:12px;font-weight:600;";
    plateRow.textContent = spot.plate;
    el.appendChild(plateRow);

    if (spot.carrier) {
      const carrierRow = document.createElement("div");
      carrierRow.style.cssText = "font-size:11px;color:#64748b;";
      carrierRow.textContent = spot.carrier;
      el.appendChild(carrierRow);
    }
    const dwell = dwellLabel(spot);
    if (dwell) {
      const dwellRow = document.createElement("div");
      dwellRow.style.cssText = "font-size:11px;color:#64748b;margin-top:2px;";
      dwellRow.textContent = dwell;
      el.appendChild(dwellRow);
    }
  } else {
    const emptyRow = document.createElement("div");
    emptyRow.style.cssText = "margin-top:6px;font-size:11px;color:#94a3b8;";
    emptyRow.textContent = "Empty";
    el.appendChild(emptyRow);
  }
  return el;
}

export default function YardMap({ spots, facility, unresolvedSafetySpotIds, spotsWithOpenExceptions, onSelectSpot, height = "520px", className = "" }: YardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const spotMarkersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  // Truck markers persist across renders keyed by plate (not spot id) —
  // that's what lets the *same* DOM element animate from its old spot's
  // coordinates to its new one instead of being torn down and recreated.
  const truckMarkersRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLDivElement; spotId: number }>>(new Map());
  const [style, setStyle] = useState<"streets" | "satellite">("streets");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesSlow, setTilesSlow] = useState(false);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [facility.longitude, facility.latitude],
        zoom: 17,
      });
    } catch (e: any) {
      setLoadError(e?.message || "Failed to initialize map");
      return;
    }
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "top-right");
    map.on("error", (e: any) => setLoadError(e?.error?.message || "Map error"));
    map.on("load", () => setReady(true));
    // mapbox-gl doesn't reliably surface individual failed tile fetches
    // as a map-level 'error' (they're treated as retryable, not fatal) —
    // a flaky network can leave the map visibly blank with no feedback at
    // all. 'idle' fires once every tile the current view needs has
    // resolved one way or another; if it hasn't within 8s of load, tiles
    // are genuinely struggling and the user deserves to know why the map
    // looks empty instead of it just looking frozen.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    map.on("load", () => {
      idleTimer = setTimeout(() => setTilesSlow(true), 8000);
      map.once("idle", () => { if (idleTimer) clearTimeout(idleTimer); setTilesSlow(false); });
    });
    mapRef.current = map;

    return () => {
      spotMarkersRef.current.forEach((m) => m.remove());
      spotMarkersRef.current.clear();
      truckMarkersRef.current.forEach((t) => t.marker.remove());
      truckMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    mapRef.current.setStyle(style === "streets" ? "mapbox://styles/mapbox/streets-v12" : "mapbox://styles/mapbox/satellite-streets-v12");
  }, [style, ready]);

  useEffect(() => {
    if (!containerRef.current || !mapRef.current) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready]);

  const facilityMarkerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!facilityMarkerRef.current) {
      const facilityEl = document.createElement("div");
      facilityEl.style.cssText = "width:14px;height:14px;border-radius:3px;background:#0f172a;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35);";
      facilityMarkerRef.current = new mapboxgl.Marker({ element: facilityEl }).setLngLat([facility.longitude, facility.latitude]).addTo(map);
    } else {
      facilityMarkerRef.current.setLngLat([facility.longitude, facility.latitude]);
    }
    facilityMarkerRef.current.setPopup(new mapboxgl.Popup({ offset: 12 }).setText(facility.configured ? facility.name : `${facility.name} (approximate — set real coordinates in Settings)`));

    const alertIds = new Set([...(unresolvedSafetySpotIds || []), ...(spotsWithOpenExceptions || [])]);

    // --- Infrastructure markers (docks/parking spots): fixed position,
    // persistent by spot id, only their color/popup ever changes. ---
    const seenSpotIds = new Set<number>();
    for (const spot of spots) {
      if (spot.latitude == null || spot.longitude == null) continue;
      seenSpotIds.add(spot.id);
      const state = markerState(spot, alertIds);
      const style = `width:16px;height:16px;border-radius:${spot.type === "DOCK" ? "4px" : "50%"};background:${STATE_COLOR[state]};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer;${state === "alert" ? "animation:yard-map-pulse 1.4s infinite;" : ""}`;

      let existing = spotMarkersRef.current.get(spot.id);
      if (!existing) {
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", spot.name);
        el.style.cssText = style;
        el.addEventListener("click", () => onSelectSpot?.((el as any)._spot));
        (el as any)._spot = spot;
        existing = new mapboxgl.Marker({ element: el }).setLngLat([spot.longitude, spot.latitude]).addTo(map);
        spotMarkersRef.current.set(spot.id, existing);
      } else {
        const el = existing.getElement() as any;
        el.style.cssText = style;
        el._spot = spot;
      }
      existing.setPopup(new mapboxgl.Popup({ offset: 12 }).setDOMContent(buildPopupNode(spot)));
    }
    for (const [id, marker] of spotMarkersRef.current) {
      if (!seenSpotIds.has(id)) {
        marker.remove();
        spotMarkersRef.current.delete(id);
      }
    }

    // --- Truck markers: one per occupied spot, keyed by plate so the same
    // element survives a move and can animate to its new position. ---
    const occupied = spots.filter((s) => s.plate && s.latitude != null && s.longitude != null);
    const seenPlates = new Set<string>();
    for (const spot of occupied) {
      const plate = spot.plate as string;
      seenPlates.add(plate);
      const to: [number, number] = [spot.longitude as number, spot.latitude as number];
      const existing = truckMarkersRef.current.get(plate);

      if (!existing) {
        const el = document.createElement("div");
        el.style.cssText = "width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:13px;background:#1e1b4b;border-radius:6px;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,.45);cursor:pointer;";
        el.textContent = "🚚";
        el.setAttribute("aria-label", `Trailer ${plate}`);
        const marker = new mapboxgl.Marker({ element: el }).setLngLat(to).setPopup(new mapboxgl.Popup({ offset: 14 }).setDOMContent(buildPopupNode(spot))).addTo(map);
        el.addEventListener("click", () => onSelectSpot?.(spot));
        truckMarkersRef.current.set(plate, { marker, el, spotId: spot.id });
      } else if (existing.spotId !== spot.id) {
        // Real movement: this plate's spot changed since the last render —
        // animate from the last known position to the new one instead of
        // teleporting, and flag it visually for a few seconds like the
        // grid view's "moved" indicator does.
        const from = existing.marker.getLngLat();
        animateMarkerTo(existing.marker, [from.lng, from.lat], to, 1200);
        existing.el.style.boxShadow = "0 0 0 3px rgba(79,70,229,.6), 0 2px 5px rgba(0,0,0,.45)";
        setTimeout(() => { existing.el.style.boxShadow = "0 2px 5px rgba(0,0,0,.45)"; }, 3000);
        existing.marker.setPopup(new mapboxgl.Popup({ offset: 14 }).setDOMContent(buildPopupNode(spot)));
        existing.spotId = spot.id;
      } else {
        existing.marker.setPopup(new mapboxgl.Popup({ offset: 14 }).setDOMContent(buildPopupNode(spot)));
      }
    }
    for (const [plate, t] of truckMarkersRef.current) {
      if (!seenPlates.has(plate)) {
        t.marker.remove();
        truckMarkersRef.current.delete(plate);
      }
    }
  }, [spots, ready, unresolvedSafetySpotIds, spotsWithOpenExceptions, onSelectSpot, facility]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 ${className}`} style={{ height }}>
        <span className="text-sm font-bold">Map unavailable</span>
        <span className="text-xs">VITE_MAPBOX_ACCESS_TOKEN not configured</span>
      </div>
    );
  }

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-slate-200 ${className}`} style={{ height }}>
      <style>{`@keyframes yard-map-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.7); opacity: .5; } }`}</style>
      {/* mapbox-gl.css ships its own `.mapboxgl-map { position: relative }`,
          which wins the cascade over Tailwind's `.absolute` class (same
          specificity, loaded later) and collapses this container to 0
          height. Inline style always wins over any stylesheet class. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div className="absolute top-3 left-3 z-10 flex gap-1 bg-white/95 backdrop-blur rounded-lg p-1 shadow-sm border border-slate-200">
        <button type="button" onClick={() => setStyle("streets")} className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-md transition-colors ${style === "streets" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>Map</button>
        <button type="button" onClick={() => setStyle("satellite")} className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-md transition-colors ${style === "satellite" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>Satellite</button>
      </div>
      {!facility.configured && (
        <div className="absolute bottom-3 left-3 z-10 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold px-2.5 py-1.5 rounded-lg shadow-sm max-w-[70%]">
          Approximate location — set real facility coordinates in Settings
        </div>
      )}
      {!ready && !loadError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400 pointer-events-none">
          <div className="w-6 h-6 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <span className="text-xs font-bold uppercase tracking-widest">Loading map…</span>
        </div>
      )}
      {ready && tilesSlow && !loadError && (
        <div className="absolute bottom-3 right-3 z-10 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold px-2.5 py-1.5 rounded-lg shadow-sm">
          Map tiles are slow to load — check your network
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 text-red-600 text-sm font-bold px-4 text-center">
          Map error: {loadError}
        </div>
      )}
    </div>
  );
}
