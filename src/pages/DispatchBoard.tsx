import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Truck, DoorOpen, LogOut, CheckCircle2, X, Loader2, MapPin, UserCheck, UserX, Hand, LayoutGrid } from "lucide-react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../contexts/AuthContext";

export default function DispatchBoard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [yard, setYard] = useState<any>({ spots: [], moves: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [targetSpot, setTargetSpot] = useState<number | "">("");
  const [assignTo, setAssignTo] = useState<number | "">("");
  const [movePriority, setMovePriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [hostlers, setHostlers] = useState<any[]>([]);
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [claimBusyId, setClaimBusyId] = useState<number | null>(null);
  const [parkingRecs, setParkingRecs] = useState<any[]>([]);
  const [applyingRecId, setApplyingRecId] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/yard-status");
      setYard(await res.json());
    } catch {}
    setLoading(false);
  };

  const loadParkingRecs = async () => {
    try {
      const res = await fetch("/api/admin/smart-parking");
      if (res.ok) setParkingRecs(await res.json());
    } catch {}
  };

  useEffect(() => {
    load();
    loadParkingRecs();
    if (user?.role === "superadmin" || user?.role === "ADMIN") {
      fetch("/api/admin/hostlers").then((r) => (r.ok ? r.json() : [])).then((d) => setHostlers(Array.isArray(d) ? d : [])).catch(() => {});
    }
    const socket = io();
    socket.on("yard_update", () => { load(); loadParkingRecs(); });
    socket.on("move_update", () => { load(); loadParkingRecs(); });
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  // Phase 12: Smart Parking — recommendation only, an admin/hostler has to
  // click through to actually create the move order (never silently moved).
  const applyParkingRec = async (rec: any) => {
    setApplyingRecId(rec.trailerId);
    try {
      const res = await fetch("/api/create-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trailerId: rec.trailerId, fromSpotId: rec.currentSpotId, toSpotId: rec.recommendedSpotId, priority: "normal" }),
      });
      if (res.ok) {
        toast(`Move order created: ${rec.plate} → ${rec.recommendedSpotName}`, "success");
        load();
        loadParkingRecs();
      } else {
        toast("Failed to create move", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setApplyingRecId(null);
  };

  const spots = yard.spots || [];
  const moves = yard.moves || [];

  const emptySpots = useMemo(() => spots.filter((s: any) => !s.trailer_status && s.status !== "OCCUPIED"), [spots]);

  const openSpot = (spot: any) => {
    if (!spot.plate) return; // only occupied spots can be moved/dispatched
    setSelected(spot);
    setTargetSpot("");
  };

  const createMove = async () => {
    if (!selected || !targetSpot) return;
    setBusy(true);
    try {
      const res = await fetch("/api/create-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trailerId: selected.trailer_id || selected.id, fromSpotId: selected.id, toSpotId: targetSpot, assignedTo: assignTo || undefined, priority: movePriority }),
      });
      if (res.ok) {
        toast("Move order created", "success");
        setSelected(null);
        setAssignTo("");
        setMovePriority("normal");
        load();
      } else {
        toast("Failed to create move", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBusy(false);
  };

  const dispatchTrailer = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trailerId: selected.trailer_id || selected.id, spotId: selected.id }),
      });
      if (res.ok) {
        toast(`${selected.plate} dispatched`, "success");
        setSelected(null);
        load();
      } else {
        toast("Dispatch failed", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBusy(false);
  };

  const [completingId, setCompletingId] = useState<number | null>(null);

  const completeMove = async (moveId: number) => {
    // No guard here before meant a double-click (easy to do on a gate
    // tablet, or while waiting on a slow network) could fire this twice —
    // the backend now rejects the retry cleanly, but locking the button
    // per-move-id stops the duplicate request from firing at all.
    if (completingId === moveId) return;
    setCompletingId(moveId);
    try {
      const res = await fetch("/api/complete-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast("Move completed", "success");
        load();
      } else {
        toast(data.error || "Failed to complete move", res.status === 409 ? "info" : "error");
      }
    } catch {
      toast("Network error completing move", "error");
    }
    setCompletingId(null);
  };

  const claimMove = async (moveId: number) => {
    if (claimBusyId === moveId) return;
    setClaimBusyId(moveId);
    try {
      const res = await fetch(`/api/moves/${moveId}/claim`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { toast("Task claimed", "success"); load(); }
      else toast(data.error || "Failed to claim task", res.status === 409 ? "info" : "error");
    } catch {
      toast("Network error claiming task", "error");
    }
    setClaimBusyId(null);
  };

  const releaseMove = async (moveId: number) => {
    if (claimBusyId === moveId) return;
    setClaimBusyId(moveId);
    try {
      const res = await fetch(`/api/moves/${moveId}/release`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { toast("Task released back to the pool", "success"); load(); }
      else toast(data.error || "Failed to release task", "error");
    } catch {
      toast("Network error releasing task", "error");
    }
    setClaimBusyId(null);
  };

  const visibleMoves = myTasksOnly ? moves.filter((m: any) => m.assigned_to === user?.id) : moves;
  // moves already arrives priority-then-age sorted from the server
  // (Phase UU) — the top unclaimed one IS the recommendation. Surfaced
  // as a highlight, never auto-assigned, per the "don't silently assign"
  // rule — a hostler still has to claim it themselves.
  const recommendedMoveId = moves.find((m: any) => !m.assigned_to)?.id ?? null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-xs font-bold uppercase tracking-widest">Loading dispatch board...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div>
        <h1 className="text-3xl font-bold text-[var(--on-surface)] tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Dispatch & Move Orders</h1>
        <p className="text-slate-500 font-medium">Click an occupied spot to move it to a dock/parking slot, or dispatch it off-site.</p>
      </div>

      {parkingRecs.length > 0 && (
        <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-6">
          <h3 className="font-bold text-[var(--on-surface)] text-base mb-4 flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <MapPin size={16} className="text-emerald-400" /> Smart parking suggestions
          </h3>
          <div className="space-y-2">
            {parkingRecs.map((rec: any) => (
              <div key={rec.trailerId} className="flex items-center justify-between gap-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                <div className="text-sm">
                  <span className="font-bold text-[var(--on-surface)]">{rec.plate}</span>
                  <span className="text-slate-500"> · {rec.currentSpotName} → {rec.recommendedSpotName}</span>
                  <p className="text-xs text-slate-500 mt-0.5">{rec.reason} {rec.expectedBenefit}.</p>
                </div>
                <button
                  onClick={() => applyParkingRec(rec)}
                  disabled={applyingRecId === rec.trailerId}
                  className="shrink-0 bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-emerald-500 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {applyingRecId === rec.trailerId && <Loader2 size={12} className="animate-spin" />} Create move
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-8">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h3 className="font-bold text-[var(--on-surface)] text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
              <LayoutGrid size={18} className="text-indigo-400" /> Yard spots — click an occupied one to move it
            </h3>
          </div>

          <div className="flex flex-wrap gap-3">
            {spots.map((spot: any) => (
              <button
                key={spot.id}
                onClick={() => openSpot(spot)}
                className={`w-20 h-16 rounded-xl border flex flex-col items-center justify-center text-[10px] font-bold transition-all shadow-sm ${
                  spot.plate
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:border-indigo-500 cursor-pointer"
                    : "bg-[var(--surface-container-low)] border-[var(--outline-variant)]/30 text-[var(--on-surface-variant)] cursor-default"
                }`}
              >
                <span>{spot.name}</span>
                {spot.plate && <span className="truncate max-w-[70px] text-[9px] font-medium mt-0.5">{spot.plate}</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-6 mt-6">
            <Legend label="Occupied (click to move)" color="bg-indigo-500" />
            <Legend label="Empty" color="bg-slate-200" />
          </div>
        </div>

        <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-8">
          <div className="flex items-center justify-between gap-3 mb-6">
            <h3 className="font-bold text-[var(--on-surface)] text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
              <ArrowRight size={18} className="text-amber-400" /> Move tasks
            </h3>
            {user?.role === "HOSTLER" && (
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer">
                <input type="checkbox" checked={myTasksOnly} onChange={(e) => setMyTasksOnly(e.target.checked)} className="accent-indigo-600" /> My tasks only
              </label>
            )}
          </div>
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {visibleMoves.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">{myTasksOnly ? "No tasks claimed by you." : "No moves in progress."}</p>}
            {visibleMoves.map((m: any) => {
              const isMine = m.assigned_to === user?.id;
              const isClaimed = !!m.assigned_to;
              const isRecommended = m.id === recommendedMoveId;
              return (
                <div key={m.id} className={`p-4 rounded-2xl border ${isRecommended ? "bg-indigo-500/10 border-indigo-500/40 ring-2 ring-indigo-500/20" : "bg-[var(--surface-container-low)] border-[var(--outline-variant)]/30"}`}>
                  {isRecommended && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 mb-2 flex items-center gap-1">
                      <Hand size={10} /> Recommended next
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-[var(--on-surface)] text-sm flex items-center gap-1.5">
                        {m.plate}
                        {m.priority && m.priority !== "normal" && (
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                            m.priority === "urgent" ? "bg-red-500/15 text-red-700" : m.priority === "high" ? "bg-amber-500/15 text-amber-800" : "bg-[var(--surface-container-high)] text-[var(--on-surface-variant)]"
                          }`}>
                            {m.priority}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        {m.from_name} <ArrowRight size={10} /> {m.to_name}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${isClaimed ? "bg-indigo-500/15 text-indigo-700" : "bg-[var(--surface-container-high)] text-[var(--on-surface-variant)]"}`}>
                      {isClaimed ? (isMine ? "You" : m.assignee_name || "Assigned") : "Unassigned"}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {!isClaimed && (
                      <button onClick={() => claimMove(m.id)} disabled={claimBusyId === m.id} className="flex-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-700 text-xs font-bold py-2 rounded-lg hover:bg-indigo-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                        {claimBusyId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />} Claim
                      </button>
                    )}
                    {isClaimed && (isMine || user?.role === "ADMIN" || user?.role === "superadmin") && (
                      <button onClick={() => releaseMove(m.id)} disabled={claimBusyId === m.id} className="bg-[var(--surface-container-high)] border border-[var(--outline-variant)] text-[var(--on-surface-variant)] text-xs font-bold px-3 py-2 rounded-lg hover:bg-slate-700 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                        <UserX size={12} />
                      </button>
                    )}
                    <button onClick={() => completeMove(m.id)} disabled={completingId === m.id} className="flex-1 bg-slate-900 text-white text-xs font-bold py-2 rounded-lg hover:bg-indigo-600 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                      {completingId === m.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Complete
                    </button>
                  </div>
                </div>
              );
            })}
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
              className="bg-white border-l border-[var(--outline-variant)]/30 p-8 max-w-md w-full h-full shadow-2xl overflow-y-auto custom-scrollbar"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-lg text-[var(--on-surface)]" style={{ fontFamily: "var(--font-heading)" }}>{selected.plate}</h3>
                <p className="text-xs text-slate-500">{selected.carrier} &middot; currently at {selected.name}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-[var(--on-surface-variant)] hover:text-black transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <DoorOpen size={12} /> Move to
                </label>
                <select value={targetSpot} onChange={(e) => setTargetSpot(Number(e.target.value))} className="w-full bg-[var(--surface-container-low)] border border-[var(--outline-variant)] text-[var(--on-surface)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <option value="">Select a free spot...</option>
                  {emptySpots.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Priority</label>
                <select value={movePriority} onChange={(e) => setMovePriority(e.target.value)} className="w-full bg-[var(--surface-container-low)] border border-[var(--outline-variant)] text-[var(--on-surface)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              {hostlers.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <UserCheck size={12} /> Assign to (optional)
                  </label>
                  <select value={assignTo} onChange={(e) => setAssignTo(e.target.value ? Number(e.target.value) : "")} className="w-full bg-[var(--surface-container-low)] border border-[var(--outline-variant)] text-[var(--on-surface)] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                    <option value="">Leave unassigned — claimable by any hostler</option>
                    {hostlers.map((h: any) => (
                      <option key={h.id} value={h.id}>
                        {h.name}{h.recommended ? " — Recommended" : ""}{h.reason ? ` (${h.reason})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button onClick={createMove} disabled={busy || !targetSpot} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-500 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Create move order
              </button>

              <div className="pt-4 border-t border-slate-800">
                <button onClick={dispatchTrailer} disabled={busy} className="w-full bg-red-500/10 text-red-700 py-2.5 rounded-xl text-sm font-bold hover:bg-red-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <LogOut size={14} /> Dispatch off-site
                </button>
              </div>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}
