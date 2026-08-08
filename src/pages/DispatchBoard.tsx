import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Truck, DoorOpen, LogOut, CheckCircle2, X, Loader2, MapPin, UserCheck, UserX, Hand } from "lucide-react";
import { io } from "socket.io-client";
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
  const [busy, setBusy] = useState(false);
  const [hostlers, setHostlers] = useState<any[]>([]);
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [claimBusyId, setClaimBusyId] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/yard-status");
      setYard(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (user?.role === "superadmin" || user?.role === "ADMIN") {
      fetch("/api/admin/hostlers").then((r) => (r.ok ? r.json() : [])).then((d) => setHostlers(Array.isArray(d) ? d : [])).catch(() => {});
    }
    const socket = io();
    socket.on("yard_update", load);
    socket.on("move_update", load);
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

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
        body: JSON.stringify({ trailerId: selected.trailer_id || selected.id, fromSpotId: selected.id, toSpotId: targetSpot, assignedTo: assignTo || undefined }),
      });
      if (res.ok) {
        toast("Move order created", "success");
        setSelected(null);
        setAssignTo("");
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
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dispatch & Move Orders</h1>
        <p className="text-slate-500 font-medium">Click an occupied spot to move it to a dock/parking slot, or dispatch it off-site.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
          <h3 className="font-bold text-slate-900 text-lg mb-6 flex items-center gap-2">
            <MapPin size={18} className="text-indigo-600" /> Yard map
          </h3>
          <div className="flex flex-wrap gap-3">
            {spots.map((spot: any) => (
              <button
                key={spot.id}
                onClick={() => openSpot(spot)}
                className={`w-20 h-16 rounded-xl border flex flex-col items-center justify-center text-[10px] font-bold transition-all shadow-sm ${
                  spot.plate
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:border-indigo-500 cursor-pointer"
                    : "bg-slate-50 border-slate-100 text-slate-400 cursor-default"
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

        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
          <div className="flex items-center justify-between gap-3 mb-6">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <ArrowRight size={18} className="text-amber-600" /> Move tasks
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
              return (
                <div key={m.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{m.plate}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        {m.from_name} <ArrowRight size={10} /> {m.to_name}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${isClaimed ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-500"}`}>
                      {isClaimed ? (isMine ? "You" : m.assignee_name || "Assigned") : "Unassigned"}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {!isClaimed && (
                      <button onClick={() => claimMove(m.id)} disabled={claimBusyId === m.id} className="flex-1 bg-white border border-indigo-200 text-indigo-700 text-xs font-bold py-2 rounded-lg hover:bg-indigo-50 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                        {claimBusyId === m.id ? <Loader2 size={12} className="animate-spin" /> : <Hand size={12} />} Claim
                      </button>
                    )}
                    {isClaimed && (isMine || user?.role === "ADMIN" || user?.role === "superadmin") && (
                      <button onClick={() => releaseMove(m.id)} disabled={claimBusyId === m.id} className="bg-white border border-slate-200 text-slate-500 text-xs font-bold px-3 py-2 rounded-lg hover:bg-slate-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
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

      {selected && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-lg text-slate-900">{selected.plate}</h3>
                <p className="text-xs text-slate-500">{selected.carrier} &middot; currently at {selected.name}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-900">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <DoorOpen size={12} /> Move to
                </label>
                <select value={targetSpot} onChange={(e) => setTargetSpot(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="">Select a free spot...</option>
                  {emptySpots.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
                  ))}
                </select>
              </div>
              {hostlers.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <UserCheck size={12} /> Assign to (optional)
                  </label>
                  <select value={assignTo} onChange={(e) => setAssignTo(e.target.value ? Number(e.target.value) : "")} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                    <option value="">Leave unassigned — claimable by any hostler</option>
                    {hostlers.map((h: any) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <button onClick={createMove} disabled={busy || !targetSpot} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Create move order
              </button>

              <div className="pt-4 border-t border-slate-100">
                <button onClick={dispatchTrailer} disabled={busy} className="w-full bg-red-50 text-red-600 py-2.5 rounded-xl text-sm font-bold hover:bg-red-100 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <LogOut size={14} /> Dispatch off-site
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
