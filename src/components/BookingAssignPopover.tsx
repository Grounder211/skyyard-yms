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
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) {
      onConfirm();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed");
    }
  };

  return (
    <div
      className="fixed z-[9999] bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 w-80"
      style={{ left: Math.min(position.x, window.innerWidth - 340), top: Math.min(position.y, window.innerHeight - 280) }}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold text-slate-900 text-sm">{mode === "assign" ? "Schedule this booking?" : "Move this booking?"}</h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-900"><X size={16} /></button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        <span className="font-bold text-slate-900">{plate}</span> {mode === "assign" ? "to" : "moves to"} <span className="font-bold text-slate-900">{new Date(dropTime).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
      </p>

      {mode === "assign" && (
        <div className="mb-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">Dock</label>
          {loadingDocks ? (
            <p className="text-xs text-slate-400">Checking availability...</p>
          ) : (
            <select value={selectedDockId ?? ""} onChange={(e) => setSelectedDockId(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
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

      {error && <p className="text-xs text-red-600 font-bold mb-3">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 bg-slate-100 text-slate-600 text-xs font-bold py-2 rounded-xl hover:bg-slate-200 transition-all">Cancel</button>
        <button
          onClick={confirm}
          disabled={busy || (mode === "assign" && !selectedDockId)}
          className="flex-1 bg-indigo-600 text-white text-xs font-bold py-2 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 size={12} className="animate-spin" />} Confirm
        </button>
      </div>
    </div>
  );
}
