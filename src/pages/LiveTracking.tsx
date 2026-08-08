import React, { useEffect, useMemo, useRef, useState } from "react";
import { Radar, Truck, Clock, AlertTriangle, Activity, DoorOpen, LogIn, LogOut, ArrowRightLeft, X, History, Search } from "lucide-react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "../contexts/ToastContext";

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
  const [yard, setYard] = useState<any>({ spots: [], moves: [], detentionThresholdHours: 24 });
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [, forceTick] = useState(0);
  const [query, setQuery] = useState("");
  const [dragOverSpotId, setDragOverSpotId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);

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
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Radar className="text-indigo-600" size={26} /> Live Tracking
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
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h3 className="font-bold text-slate-900 text-lg">Yard digital twin</h3>
            <div className="flex gap-4">
              <Legend color="bg-slate-200" label="Empty" />
              <Legend color="bg-teal-500" label="On time" />
              <Legend color="bg-amber-500" label="Approaching limit" />
              <Legend color="bg-red-500" label="Detention" />
            </div>
          </div>
          <div className="relative mb-6">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by plate, carrier, or PO — drag an occupied spot onto an empty one to request a move"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {(yard.spots || []).map((spot: any) => {
              const status = spot.plate ? statusOf(spot) : "empty";
              const bg =
                status === "breach" ? "bg-red-50 border-red-300 text-red-700" :
                status === "warning" ? "bg-amber-50 border-amber-300 text-amber-700" :
                status === "normal" ? "bg-teal-50 border-teal-300 text-teal-700" :
                "bg-slate-50 border-slate-100 text-slate-400";
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
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
          <h3 className="font-bold text-slate-900 text-lg mb-6 flex items-center gap-2">
            <Activity size={18} className="text-indigo-600" /> Live activity feed
          </h3>
          <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
            {logs.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">No recent gate activity.</p>}
            {logs.map((l) => (
              <div key={l.id} className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${l.event_type === "denied" ? "bg-red-100 text-red-600" : l.event_type === "exit" ? "bg-slate-100 text-slate-500" : "bg-teal-100 text-teal-600"}`}>
                  {EVENT_ICON[l.event_type] || <ArrowRightLeft size={12} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {l.truck_plate || "Trailer"} — {l.event_type}
                  </p>
                  <p className="text-[11px] text-slate-400">{new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {l.guard_name ? `· ${l.guard_name}` : ""}</p>
                  {l.notes && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{l.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-slate-900">{selected.plate}</h3>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-900">
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
              <Row label="Time on site" value={elapsed(selected.checked_in_at || selected.check_in_time || new Date().toISOString())} mono />
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100">
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
                      <p className="font-semibold text-slate-800">{ev.label}</p>
                      {ev.detail && <p className="text-slate-400 truncate">{typeof ev.detail === "string" ? ev.detail : JSON.stringify(ev.detail)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({ icon, label, value, color }: any) {
  const colors: any = {
    indigo: "bg-indigo-50 text-indigo-600",
    teal: "bg-teal-50 text-teal-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>{icon}</div>
      <div>
        <p className="text-xl font-bold text-slate-900 leading-none">{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">{label}</p>
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
    <div className="flex justify-between items-center py-1.5 border-b border-slate-50">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className={`font-bold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
