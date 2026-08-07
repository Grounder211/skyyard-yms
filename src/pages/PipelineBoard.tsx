import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { ShieldCheck, Clock, ArrowRight, CheckCircle2, LogOut, AlertTriangle, Loader2, X } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

const STAGES = [
  { key: "IN_PASS", label: "In-Pass", color: "indigo" },
  { key: "PARKED", label: "Parked", color: "slate" },
  { key: "LOADING", label: "Loading / Unloading", color: "amber" },
  { key: "UNLOADING", label: "Loading / Unloading", color: "amber", mergeWith: "LOADING" },
  { key: "READY_FOR_EXIT", label: "Ready for Exit", color: "teal" },
  { key: "OUT_PASS", label: "Out-Pass Issued", color: "red" },
];

const COLOR_CLASSES: Record<string, string> = {
  indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
  slate: "bg-slate-50 border-slate-200 text-slate-600",
  amber: "bg-amber-50 border-amber-200 text-amber-700",
  teal: "bg-teal-50 border-teal-200 text-teal-700",
  red: "bg-red-50 border-red-200 text-red-700",
};

const NEXT_STAGE: Record<string, string> = {
  IN_PASS: "PARKED",
  PARKED: "LOADING",
  LOADING: "READY_FOR_EXIT",
  UNLOADING: "READY_FOR_EXIT",
  READY_FOR_EXIT: "OUT_PASS",
};

function timeInStage(updatedAt: string) {
  const mins = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function PipelineBoard() {
  const { toast } = useToast();
  const [passes, setPasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyTarget, setVerifyTarget] = useState<any>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  const load = async () => {
    try {
      const res = await fetch("/api/gate-pass/active");
      if (res.ok) setPasses(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const socket = io();
    socket.on("yard_update", load);
    const tick = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => {
      socket.disconnect();
      clearInterval(tick);
    };
  }, []);

  const advance = async (pass: any, stage: string) => {
    setBusy(pass.id);
    const res = await fetch(`/api/gate-pass/${pass.id}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    setBusy(null);
    if (res.ok) {
      toast(`${pass.plate} moved to ${stage.replace(/_/g, " ").toLowerCase()}`, "success");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to advance", "error");
    }
  };

  const issueOutPass = async (pass: any) => {
    setBusy(pass.id);
    const res = await fetch(`/api/gate-pass/${pass.id}/out-pass`, { method: "POST" });
    setBusy(null);
    if (res.ok) {
      toast(`Out-pass issued for ${pass.plate}`, "success");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to issue out-pass", "error");
    }
  };

  const confirmExit = async (pass: any) => {
    setBusy(pass.id);
    const res = await fetch(`/api/gate-pass/${pass.id}/exit`, { method: "POST" });
    setBusy(null);
    if (res.ok) {
      toast(`${pass.plate} exited`, "success");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Failed to confirm exit", "error");
    }
  };

  const submitVerify = async (pass: any, checklist: { license_verified: boolean; vehicle_matched: boolean; documents_ok: boolean }) => {
    setBusy(pass.id);
    const res = await fetch(`/api/gate-pass/${pass.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checklist),
    });
    setBusy(null);
    setVerifyTarget(null);
    if (res.ok) {
      toast("Verification recorded", "success");
      load();
    } else {
      toast("Failed to save verification", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const columns = STAGES.filter((s) => !s.mergeWith);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-20">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <ShieldCheck className="text-indigo-600" size={26} /> Vehicle Pipeline
        </h1>
        <p className="text-slate-500 font-medium">In-pass to out-pass — every vehicle's stage in the yard, live.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
        {columns.map((col) => {
          const items = passes.filter((p) => p.stage === col.key || p.stage === col.mergeWith || (col.key === "LOADING" && p.stage === "UNLOADING"));
          return (
            <div key={col.key} className="bg-slate-50 rounded-2xl p-3 min-h-[200px]">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{col.label}</h3>
                <span className="text-xs font-bold text-slate-400 bg-white rounded-full w-5 h-5 flex items-center justify-center">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((p) => {
                  const stale = timeInStage(p.updated_at).includes("h") && (p.stage === "LOADING" || p.stage === "UNLOADING");
                  return (
                    <div key={p.id} className={`bg-white border rounded-xl p-3 space-y-2 ${stale ? "border-amber-300" : "border-slate-200"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-sm truncate">{p.plate}</p>
                          <p className="text-[10px] text-slate-400 truncate">{p.carrier_name || "—"}</p>
                        </div>
                        {stale && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-mono">{p.pass_number}</span>
                        <span className="flex items-center gap-1"><Clock size={10} /> {timeInStage(p.updated_at)}</span>
                      </div>
                      {p.spot_name && <p className="text-[10px] font-bold text-indigo-600">{p.spot_name}</p>}

                      {p.stage === "IN_PASS" && !(p.license_verified && p.vehicle_matched) && (
                        <button onClick={() => setVerifyTarget(p)} className="w-full text-[10px] font-bold bg-amber-100 text-amber-700 rounded-lg py-1.5 hover:bg-amber-200 transition-all">
                          Verify driver & vehicle
                        </button>
                      )}

                      <div className="flex gap-1.5">
                        {col.key === "OUT_PASS" ? (
                          <button onClick={() => confirmExit(p)} disabled={busy === p.id} className="flex-1 text-[10px] font-bold bg-red-600 text-white rounded-lg py-1.5 hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                            {busy === p.id ? <Loader2 size={10} className="animate-spin" /> : <LogOut size={10} />} Confirm exit
                          </button>
                        ) : col.key === "READY_FOR_EXIT" ? (
                          <button onClick={() => issueOutPass(p)} disabled={busy === p.id} className="flex-1 text-[10px] font-bold bg-indigo-600 text-white rounded-lg py-1.5 hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                            {busy === p.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />} Issue out-pass
                          </button>
                        ) : col.key === "LOADING" ? (
                          <>
                            <button onClick={() => advance(p, p.stage === "UNLOADING" ? "LOADING" : "UNLOADING")} disabled={busy === p.id} className="flex-1 text-[10px] font-bold bg-slate-100 text-slate-600 rounded-lg py-1.5 hover:bg-slate-200 transition-all disabled:opacity-50">
                              Swap
                            </button>
                            <button onClick={() => advance(p, "READY_FOR_EXIT")} disabled={busy === p.id} className="flex-1 text-[10px] font-bold bg-indigo-600 text-white rounded-lg py-1.5 hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                              {busy === p.id ? <Loader2 size={10} className="animate-spin" /> : <ArrowRight size={10} />} Ready
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => advance(p, NEXT_STAGE[p.stage])}
                            disabled={busy === p.id || (p.stage === "IN_PASS" && !(p.license_verified && p.vehicle_matched))}
                            className="flex-1 text-[10px] font-bold bg-indigo-600 text-white rounded-lg py-1.5 hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {busy === p.id ? <Loader2 size={10} className="animate-spin" /> : <ArrowRight size={10} />} Advance
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && <p className="text-[11px] text-slate-300 text-center py-8">Empty</p>}
              </div>
            </div>
          );
        })}
      </div>

      {verifyTarget && <VerifyModal pass={verifyTarget} onClose={() => setVerifyTarget(null)} onSubmit={submitVerify} busy={busy === verifyTarget.id} />}
    </div>
  );
}

function VerifyModal({ pass, onClose, onSubmit, busy }: any) {
  const [license, setLicense] = useState(!!pass.license_verified);
  const [vehicle, setVehicle] = useState(!!pass.vehicle_matched);
  const [docs, setDocs] = useState(!!pass.documents_ok);

  return (
    <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">Verify {pass.plate}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-500 mb-5">Confirm the driver and vehicle presented at the gate match what's on file before letting them proceed past in-pass.</p>
        <div className="space-y-3 mb-6">
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={license} onChange={(e) => setLicense(e.target.checked)} className="w-4 h-4" /> Driver license matches
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={vehicle} onChange={(e) => setVehicle(e.target.checked)} className="w-4 h-4" /> Vehicle / plate matches
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} className="w-4 h-4" /> Documents (seal, permits) OK
          </label>
        </div>
        <button
          onClick={() => onSubmit(pass, { license_verified: license, vehicle_matched: vehicle, documents_ok: docs })}
          disabled={busy}
          className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Save verification
        </button>
      </div>
    </div>
  );
}
