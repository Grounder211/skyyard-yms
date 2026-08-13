// src/components/BookingAssignPopover.tsx
import React, { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

interface DockOption { dockId: number; dockName: string; score: number; available: boolean; conflictReason: string | null }

export default function BookingAssignPopover({
  mode, plate, loadType, requestId, appointmentId, dropTime, position, onConfirm, onCancel,
}: {
  mode: "assign" | "reschedule";
  plate: string;
  loadType: string;
  requestId?: number;
  appointmentId?: number;
  dropTime: string;
  position: { x: number; y: number };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [docks, setDocks] = useState<DockOption[]>([]);
  const [loadingDocks, setLoadingDocks] = useState(mode === "assign");
  const [selectedDockId, setSelectedDockId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "assign") return;
    fetch(`/api/admin/booking-slot-availability?start_time=${encodeURIComponent(dropTime)}&load_type=${loadType}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: DockOption[]) => {
        setDocks(d);
        const best = d.find((x) => x.available);
        if (best) setSelectedDockId(best.dockId);
      })
      .finally(() => setLoadingDocks(false));
  }, [mode, dropTime, loadType]);

  const confirm = async () => {
    setError("");
    setBusy(true);
    const url = mode === "assign" ? `/api/admin/booking-requests/${requestId}/assign` : `/api/appointments/${appointmentId}/reschedule`;
    const body = mode === "assign" ? { start_time: dropTime, dock_id: selectedDockId } : { start_time: dropTime };
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        onConfirm();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed");
      }
    } catch {
      setError("Network error — check your connection and try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-2xl p-3.5 w-64"
      style={{ left: Math.min(position.x, window.innerWidth - 280), top: Math.min(position.y, window.innerHeight - 240) }}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-bold text-slate-900 text-xs">{mode === "assign" ? "Schedule this booking?" : "Move this booking?"}</h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-900"><X size={14} /></button>
      </div>
      <p className="text-[11px] text-slate-500 mb-2.5">
        <span className="font-bold text-slate-900">{plate}</span> {mode === "assign" ? "to" : "moves to"} <span className="font-bold text-slate-900">{new Date(dropTime).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </p>

      {mode === "assign" && (
        <div className="mb-2.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Dock</label>
          {loadingDocks ? (
            <p className="text-[11px] text-slate-400">Checking availability...</p>
          ) : (
            <select value={selectedDockId ?? ""} onChange={(e) => setSelectedDockId(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
              <option value="" disabled>Select a dock...</option>
              {docks.map((d) => (
                <option key={d.dockId} value={d.dockId} disabled={!d.available}>
                  {d.dockName}{d.available ? ` (score ${d.score})` : ` — ${d.conflictReason}`}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 font-bold mb-2.5">{error}</p>}

      <div className="flex gap-1.5">
        <button onClick={onCancel} className="flex-1 bg-slate-100 text-slate-600 text-[11px] font-bold py-1.5 rounded-lg hover:bg-slate-200 transition-all">Cancel</button>
        <button
          onClick={confirm}
          disabled={busy || (mode === "assign" && !selectedDockId)}
          className="flex-1 bg-indigo-600 text-white text-[11px] font-bold py-1.5 rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 size={11} className="animate-spin" />} Confirm
        </button>
      </div>
    </div>
  );
}
