import React, { useEffect, useMemo, useRef, useState } from "react";
import { Radar, Truck, Clock, AlertTriangle, Activity, DoorOpen, LogIn, LogOut, ArrowRightLeft, X, History, Search, Thermometer, Fuel, Loader2, Building2, ShieldAlert, Weight, Camera, Map as MapIcon, LayoutGrid } from "lucide-react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../contexts/AuthContext";
import YardMap from "../components/YardMap";

function elapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  if (ms < 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function dwellHours(since: string) {
  return (Date.now() - new Date(since).getTime()) / 3600000;
}

const EVENT_ICON: Record<string, any> = {
  entry: <LogIn size={12} />,
  exit: <LogOut size={12} />,
  denied: <AlertTriangle size={12} />,
};

export default function LiveTracking() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [yard, setYard] = useState<any>({ spots: [], moves: [], detentionThresholdHours: 24 });
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [, forceTick] = useState(0);
  const [query, setQuery] = useState("");
  const [dragOverSpotId, setDragOverSpotId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "map">("map");

  // Tracks which spot each plate last occupied, so a move between fetches
  // can be detected and animated (shared layoutId "flies" the trailer card
  // from its old spot to its new one) instead of just teleporting on reload.
  const prevSpotByPlateRef = useRef<Record<string, number>>({});
  const [justMoved, setJustMoved] = useState<Record<string, number>>({});

  const load = async () => {
    try {
      const [yardRes, logsRes] = await Promise.all([fetch("/api/yard-status"), fetch("/api/admin/gate-logs")]);
      const nextYard = await yardRes.json();

      const prevMap = prevSpotByPlateRef.current;
      const nextMap: Record<string, number> = {};
      const movedNow: string[] = [];
      for (const s of nextYard.spots || []) {
        if (!s.plate) continue;
        nextMap[s.plate] = s.id;
        if (prevMap[s.plate] !== undefined && prevMap[s.plate] !== s.id) movedNow.push(s.plate);
      }
      prevSpotByPlateRef.current = nextMap;

      if (movedNow.length) {
        const now = Date.now();
        setJustMoved((m) => {
          const next = { ...m };
          movedNow.forEach((p) => (next[p] = now));
          return next;
        });
        setTimeout(() => {
          setJustMoved((m) => {
            const next = { ...m };
            movedNow.forEach((p) => { if (next[p] === now) delete next[p]; });
            return next;
          });
        }, 3000);
      }

      setYard(nextYard);
      if (logsRes.ok) setLogs(await logsRes.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const socket = io();
    socket.on("yard_update", load);
    socket.on("move_update", load);
    return () => {
      socket.disconnect();
    };
  }, []);

  // Tick every second to keep live dwell timers moving without refetching
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const threshold = yard.detentionThresholdHours || 24;
  const occupied = useMemo(() => (yard.spots || []).filter((s: any) => s.plate), [yard.spots]);

  const statusOf = (spot: any) => {
    const since = spot.checked_in_at || spot.check_in_time;
    if (!since) return "unknown";
    const h = dwellHours(since);
    if (h >= threshold) return "breach";
    if (h >= threshold * 0.7) return "warning";
    return "normal";
  };

  const avgDwellMins = useMemo(() => {
    const withTime = occupied.filter((s: any) => s.checked_in_at || s.check_in_time);
    if (withTime.length === 0) return 0;
    const total = withTime.reduce((sum: number, s: any) => sum + (Date.now() - new Date(s.checked_in_at || s.check_in_time).getTime()) / 60000, 0);
    return Math.round(total / withTime.length);
  }, [occupied]);

  const breachCount = useMemo(() => occupied.filter((s: any) => statusOf(s) === "breach").length, [occupied, threshold]);

  const matchesQuery = (spot: any) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (spot.plate || "").toLowerCase().includes(q) || (spot.carrier || "").toLowerCase().includes(q) || (spot.po_number || "").toLowerCase().includes(q);
  };

  const requestMove = async (trailerId: number, fromSpotId: number, toSpotId: number) => {
    if (fromSpotId === toSpotId) return;
    setMoving(true);
    try {
      const res = await fetch("/api/create-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trailerId, fromSpotId, toSpotId }),
      });
      if (res.ok) toast("Move request sent", "success");
      else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "Move request failed", "error");
      }
    } catch {
      toast("Move request failed — network error", "error");
    }
    setMoving(false);
  };

  const [timeline, setTimeline] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  useEffect(() => {
    if (!selected?.plate) {
      setTimeline([]);
      return;
    }
    setTimelineLoading(true);
    fetch(`/api/trailer/${encodeURIComponent(selected.plate)}/timeline`)
      .then((r) => r.json())
      .then((d) => setTimeline(d.events || []))
      .catch(() => setTimeline([]))
      .finally(() => setTimelineLoading(false));
  }, [selected?.plate]);

  const [reeferReadings, setReeferReadings] = useState<any[]>([]);
  const [reeferForm, setReeferForm] = useState({ temperature_c: "", fuel_level_pct: "" });
  const [reeferBusy, setReeferBusy] = useState(false);

  const loadReeferReadings = (plate: string) => {
    fetch(`/api/trailers/${encodeURIComponent(plate)}/reefer-readings`)
      .then((r) => r.json())
      .then((d) => setReeferReadings(Array.isArray(d) ? d : []))
      .catch(() => setReeferReadings([]));
  };

  useEffect(() => {
    if (!selected?.plate || selected.equipment_type !== "reefer") {
      setReeferReadings([]);
      return;
    }
    loadReeferReadings(selected.plate);
  }, [selected?.plate, selected?.equipment_type]);

  const [facilities, setFacilities] = useState<any[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ destination_facility_id: "", eta: "", notes: "" });
  const [transferBusy, setTransferBusy] = useState(false);

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    fetch("/api/superadmin/facilities")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setFacilities(Array.isArray(d) ? d : []))
      .catch(() => setFacilities([]));
  }, [user?.role]);

  useEffect(() => {
    setTransferOpen(false);
    setTransferForm({ destination_facility_id: "", eta: "", notes: "" });
  }, [selected?.plate]);

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.trailer_id || !transferForm.destination_facility_id) return;
    setTransferBusy(true);
    try {
      const res = await fetch(`/api/admin/trailers/${selected.trailer_id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...transferForm, destination_facility_id: Number(transferForm.destination_facility_id) }),
      });
      const data = await res.json();
      if (res.ok) {
        toast(`Transfer initiated for ${selected.plate}`, "success");
        setTransferOpen(false);
        setSelected(null);
        setTransferForm({ destination_facility_id: "", eta: "", notes: "" });
        load();
      } else {
        toast(data.error || "Transfer failed", "error");
      }
    } catch {
      toast("Network error initiating transfer", "error");
    }
    setTransferBusy(false);
  };

  const submitReeferReading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.plate || reeferForm.temperature_c === "") return;
    setReeferBusy(true);
    try {
      const res = await fetch(`/api/trailers/${encodeURIComponent(selected.plate)}/reefer-reading`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperature_c: Number(reeferForm.temperature_c), fuel_level_pct: reeferForm.fuel_level_pct === "" ? null : Number(reeferForm.fuel_level_pct) }),
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.status === "critical" ? `Recorded — ${data.reasons?.[0] || "out of range"}` : "Reading recorded", data.status === "critical" ? "error" : "success");
        setReeferForm({ temperature_c: "", fuel_level_pct: "" });
        loadReeferReadings(selected.plate);
      } else {
        toast(data.error || "Failed to record reading", "error");
      }
    } catch {
      toast("Network error recording reading", "error");
    }
    setReeferBusy(false);
  };

  const [inspectionForm, setInspectionForm] = useState({ hazmat_class: "", tare_weight_kg: "", damage_note: "" });
  const [inspectionBusy, setInspectionBusy] = useState(false);

  useEffect(() => {
    setInspectionForm({ hazmat_class: selected?.hazmat_class || "", tare_weight_kg: selected?.tare_weight_kg != null ? String(selected.tare_weight_kg) : "", damage_note: "" });
  }, [selected?.plate]);

  const submitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.plate) return;
    setInspectionBusy(true);
    try {
      const res = await fetch(`/api/trailers/${encodeURIComponent(selected.plate)}/inspection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hazmat_class: inspectionForm.hazmat_class || null,
          tare_weight_kg: inspectionForm.tare_weight_kg,
          damage_note: inspectionForm.damage_note || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast("Inspection updated", "success");
        setSelected((s: any) => (s ? { ...s, hazmat_class: data.hazmat_class, tare_weight_kg: data.tare_weight_kg, damage_photos: data.damage_photos } : s));
        setInspectionForm((f) => ({ ...f, damage_note: "" }));
        load();
      } else {
        toast(data.error || "Failed to update inspection", "error");
      }
    } catch {
      toast("Network error updating inspection", "error");
    }
    setInspectionBusy(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-xs font-bold uppercase tracking-widest">Loading live tracking...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
          <Radar className="text-indigo-400" size={26} /> Live Tracking
        </h1>
        <p className="text-slate-500 font-medium">Digital twin of the yard — live positions, time-on-site, and gate activity as it happens.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPI icon={<Truck size={16} />} label="Trucks on site" value={occupied.length} color="indigo" />
        <KPI icon={<Clock size={16} />} label="Avg. time on site" value={`${avgDwellMins}m`} color="teal" />
        <KPI icon={<AlertTriangle size={16} />} label="Over detention threshold" value={breachCount} color={breachCount > 0 ? "red" : "teal"} />
        <KPI icon={<DoorOpen size={16} />} label="Free spots" value={(yard.spots || []).filter((s: any) => s.status === "EMPTY").length} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-[1.75rem] p-8">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h3 className="font-bold text-white text-lg" style={{ fontFamily: "var(--font-heading)" }}>Yard digital twin</h3>
            <div className="flex items-center gap-4">
              {viewMode === "grid" ? (
                <div className="flex gap-4">
                  <Legend color="bg-slate-600" label="Empty" />
                  <Legend color="bg-teal-500" label="On time" />
                  <Legend color="bg-amber-500" label="Approaching limit" />
                  <Legend color="bg-red-500" label="Detention" />
                </div>
              ) : (
                <div className="flex gap-4">
                  <Legend color="bg-slate-500" label="Available" />
                  <Legend color="bg-indigo-500" label="Occupied" />
                  <Legend color="bg-amber-500" label="Delayed" />
                  <Legend color="bg-red-500" label="Alert" />
                </div>
              )}
              <div className="flex gap-1 bg-slate-800/70 rounded-lg p-1">
                <button type="button" onClick={() => setViewMode("map")} title="Map view" className={`p-1.5 rounded-md transition-colors ${viewMode === "map" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                  <MapIcon size={14} />
                </button>
                <button type="button" onClick={() => setViewMode("grid")} title="Grid view" className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
                  <LayoutGrid size={14} />
                </button>
              </div>
            </div>
          </div>

          {viewMode === "map" && yard.facility && (
            <YardMap
              spots={yard.spots || []}
              facility={yard.facility}
              unresolvedSafetySpotIds={yard.unresolvedSafetySpotIds}
              spotsWithOpenExceptions={yard.spotsWithOpenExceptions}
              onSelectSpot={(spot: any) => spot.plate && setSelected(spot)}
              height="560px"
            />
          )}

          {viewMode === "grid" && (
          <>
          <div className="relative mb-6">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by plate, carrier, or PO — drag an occupied spot onto an empty one to request a move"
              className="w-full bg-slate-800/70 border border-slate-700 text-slate-200 placeholder:text-slate-500 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {(yard.spots || []).map((spot: any) => {
              const status = spot.plate ? statusOf(spot) : "empty";
              const bg =
                status === "breach" ? "bg-red-500/10 border-red-500/40 text-red-300" :
                status === "warning" ? "bg-amber-500/10 border-amber-500/40 text-amber-300" :
                status === "normal" ? "bg-teal-500/10 border-teal-500/40 text-teal-300" :
                "bg-slate-800/50 border-slate-700/50 text-slate-500";
              const movedAt = spot.plate ? justMoved[spot.plate] : undefined;
              const dimmed = query.trim() && !matchesQuery(spot);
              const isDropTarget = !spot.plate && dragOverSpotId === spot.id;
              return (
                <button
                  key={spot.id}
                  onClick={() => spot.plate && setSelected(spot)}
                  draggable={!!spot.plate && !moving}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/json", JSON.stringify({ trailerId: spot.trailer_id, fromSpotId: spot.id }));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (spot.plate) return;
                    e.preventDefault();
                    setDragOverSpotId(spot.id);
                  }}
                  onDragLeave={() => setDragOverSpotId((id) => (id === spot.id ? null : id))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverSpotId(null);
                    if (spot.plate) return;
                    try {
                      const { trailerId, fromSpotId } = JSON.parse(e.dataTransfer.getData("application/json"));
                      if (trailerId) requestMove(trailerId, fromSpotId, spot.id);
                    } catch {}
                  }}
                  className={`w-24 h-20 rounded-xl border flex flex-col items-center justify-center text-[10px] font-bold shadow-sm relative overflow-hidden transition-all ${bg} ${spot.plate ? "cursor-grab active:cursor-grabbing hover:scale-105" : "cursor-default"} ${movedAt ? "ring-2 ring-indigo-400" : ""} ${dimmed ? "opacity-25" : ""} ${isDropTarget ? "ring-2 ring-indigo-500 scale-105" : ""}`}
                >
                  {status === "breach" && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />}
                  <span className="absolute top-1.5 left-1.5 opacity-60">{spot.name}</span>
                  <AnimatePresence mode="popLayout">
                    {spot.plate && (
                      <motion.div
                        key={spot.plate}
                        layoutId={`trailer-${spot.plate}`}
                        layout
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ type: "spring", stiffness: 340, damping: 30 }}
                        className="flex flex-col items-center justify-center mt-2"
                      >
                        <span className="truncate max-w-[80px] text-[9px] font-medium">{spot.plate}</span>
                        <span className="font-mono text-[9px] mt-0.5 opacity-80">{elapsed(spot.checked_in_at || spot.check_in_time || new Date().toISOString())}</span>
                        {movedAt && (
                          <span className="text-[8px] mt-0.5 text-indigo-600 font-bold">
                            moved {new Date(movedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
          </div>
          </>
          )}
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-[1.75rem] p-8">
          <h3 className="font-bold text-white text-lg mb-6 flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <Activity size={18} className="text-indigo-400" /> Live activity feed
          </h3>
          <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
            {logs.length === 0 && <p className="text-sm text-slate-500 py-8 text-center">No recent gate activity.</p>}
            {logs.map((l) => (
              <div key={l.id} className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${l.event_type === "denied" ? "bg-red-500/15 text-red-300" : l.event_type === "exit" ? "bg-slate-800 text-slate-400" : "bg-teal-500/15 text-teal-300"}`}>
                  {EVENT_ICON[l.event_type] || <ArrowRightLeft size={12} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-200 truncate">
                    {l.truck_plate || "Trailer"} — {l.event_type}
                  </p>
                  <p className="text-[11px] text-slate-500">{new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {l.guard_name ? `· ${l.guard_name}` : ""}</p>
                  {l.notes && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{l.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSelected(null)}
          >
            <motion.div
              className="bg-slate-900 border-l border-slate-800 p-8 max-w-md w-full h-full shadow-2xl overflow-y-auto custom-scrollbar"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-white" style={{ fontFamily: "var(--font-heading)" }}>{selected.plate}</h3>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Carrier" value={selected.carrier} />
              <Row label="Spot" value={selected.name} />
              <Row label="Equipment" value={selected.equipment_type || "standard"} />
              <Row label="Seal" value={selected.seal_number || "—"} />
              <Row label="PO number" value={selected.po_number || "—"} />
              <Row label="Cargo / SKU" value={selected.sku_summary || "—"} />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-500">Cargo status</span>
                <select
                  value={selected.cargo_status || "expected"}
                  onChange={async (e) => {
                    const status = e.target.value;
                    const res = await fetch(`/api/trailers/${encodeURIComponent(selected.plate)}/cargo-status`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
                    });
                    if (res.ok) setSelected({ ...selected, cargo_status: status });
                  }}
                  className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs font-semibold"
                >
                  {["expected", "arrived", "checked", "loading", "loaded", "unloading", "unloaded", "short", "over", "damaged", "rejected", "completed"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <Row label="Time on site" value={elapsed(selected.checked_in_at || selected.check_in_time || new Date().toISOString())} mono />
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-3">
                <ShieldAlert size={13} /> Trailer inspection
              </h4>
              {selected.hazmat_class && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 mb-2 inline-block font-semibold">Hazmat class {selected.hazmat_class}</p>}
              {Array.isArray(selected.damage_photos) && selected.damage_photos.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {selected.damage_photos.map((d: any, i: number) => (
                    <div key={i} className="text-xs bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-2.5 py-1.5">
                      <p className="font-semibold flex items-center gap-1"><Camera size={11} /> {d.note}</p>
                      <p className="opacity-70 mt-0.5">{new Date(d.reported_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={submitInspection} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Hazmat class</label>
                    <input value={inspectionForm.hazmat_class} onChange={(e) => setInspectionForm({ ...inspectionForm, hazmat_class: e.target.value })} placeholder="e.g. 3" className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1"><Weight size={10} /> Tare weight (kg)</label>
                    <input type="number" value={inspectionForm.tare_weight_kg} onChange={(e) => setInspectionForm({ ...inspectionForm, tare_weight_kg: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Report damage</label>
                    <input value={inspectionForm.damage_note} onChange={(e) => setInspectionForm({ ...inspectionForm, damage_note: e.target.value })} placeholder="Describe any damage found" className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
                  </div>
                  <button type="submit" disabled={inspectionBusy} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
                    {inspectionBusy && <Loader2 size={12} className="animate-spin" />} Save
                  </button>
                </div>
              </form>
            </div>

            {selected.equipment_type === "reefer" && (
              <div className="mt-6 pt-4 border-t border-slate-800">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-3">
                  <Thermometer size={13} /> Reefer monitoring
                </h4>
                {selected.reefer_temp_setpoint != null && <p className="text-xs text-slate-500 mb-2">Setpoint: {selected.reefer_temp_setpoint}°C</p>}
                {reeferReadings[0] ? (
                  <div className={`rounded-xl px-3 py-2.5 mb-3 text-xs font-semibold border ${reeferReadings[0].status === "critical" ? "bg-red-500/10 border-red-500/30 text-red-300" : reeferReadings[0].status === "warning" ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-teal-500/10 border-teal-500/30 text-teal-300"}`}>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1"><Thermometer size={12} /> {reeferReadings[0].temperature_c}°C</span>
                      {reeferReadings[0].fuel_level_pct != null && <span className="flex items-center gap-1"><Fuel size={12} /> {reeferReadings[0].fuel_level_pct}%</span>}
                    </div>
                    <p className="font-normal mt-1 opacity-80">{new Date(reeferReadings[0].recorded_at).toLocaleString()}</p>
                    {(reeferReadings[0].reasons || []).length > 0 && <p className="font-normal mt-1">{reeferReadings[0].reasons.join("; ")}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mb-3">No readings recorded yet.</p>
                )}
                <form onSubmit={submitReeferReading} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Temp °C</label>
                    <input required type="number" step="0.1" value={reeferForm.temperature_c} onChange={(e) => setReeferForm({ ...reeferForm, temperature_c: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fuel %</label>
                    <input type="number" min="0" max="100" value={reeferForm.fuel_level_pct} onChange={(e) => setReeferForm({ ...reeferForm, fuel_level_pct: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
                  </div>
                  <button type="submit" disabled={reeferBusy} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                    {reeferBusy && <Loader2 size={12} className="animate-spin" />} Log
                  </button>
                </form>
              </div>
            )}

            {user?.role === "superadmin" && (
              <div className="mt-6 pt-4 border-t border-slate-800">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-3">
                  <Building2 size={13} /> Facility transfer
                </h4>
                {!transferOpen ? (
                  <button type="button" onClick={() => setTransferOpen(true)} className="w-full text-xs font-bold bg-slate-800 text-slate-300 rounded-lg py-2 hover:bg-slate-700 transition-all">
                    Transfer to another facility
                  </button>
                ) : (
                  <form onSubmit={submitTransfer} className="space-y-2.5">
                    <select required value={transferForm.destination_facility_id} onChange={(e) => setTransferForm({ ...transferForm, destination_facility_id: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
                      <option value="">Destination facility...</option>
                      {facilities.map((f: any) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <input type="datetime-local" value={transferForm.eta} onChange={(e) => setTransferForm({ ...transferForm, eta: e.target.value })} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" placeholder="ETA" />
                    <input value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} placeholder="Notes (optional)" className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setTransferOpen(false)} className="flex-1 text-xs font-bold bg-slate-800 text-slate-300 rounded-lg py-1.5 hover:bg-slate-700">Cancel</button>
                      <button type="submit" disabled={transferBusy} className="flex-1 bg-indigo-600 text-white text-xs font-bold rounded-lg py-1.5 hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                        {transferBusy && <Loader2 size={12} className="animate-spin" />} Initiate transfer
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-slate-800">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-3">
                <History size={13} /> Movement timeline
              </h4>
              {timelineLoading && <p className="text-xs text-slate-400 py-2">Loading history...</p>}
              {!timelineLoading && timeline.length === 0 && <p className="text-xs text-slate-400 py-2">No recorded events yet.</p>}
              <div className="space-y-3">
                {timeline.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs">
                    <span className="font-mono text-slate-400 shrink-0 pt-0.5">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-200">{ev.label}</p>
                      {ev.detail && <p className="text-slate-400 truncate">{typeof ev.detail === "string" ? ev.detail : JSON.stringify(ev.detail)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KPI({ icon, label, value, color }: any) {
  const colors: any = {
    indigo: "bg-indigo-500/10 text-indigo-300",
    teal: "bg-teal-500/10 text-teal-300",
    amber: "bg-amber-500/10 text-amber-300",
    red: "bg-red-500/10 text-red-300",
  };
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 flex items-center gap-3 hover:border-slate-700 hover:-translate-y-0.5 transition-all duration-200">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>{icon}</div>
      <div>
        <p className="text-xl font-bold text-white leading-none" style={{ fontFamily: "var(--font-heading)" }}>{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-slate-800/60">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className={`font-bold text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
