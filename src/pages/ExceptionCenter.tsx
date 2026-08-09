import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Loader2, ChevronDown } from "lucide-react";
import { io } from "socket.io-client";
import { useToast } from "../contexts/ToastContext";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  info: "bg-slate-50 border-slate-200 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ExceptionCenter() {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]); // unfiltered, for header stats
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const [filtered, all] = await Promise.all([
        fetch(`/api/admin/exceptions?${params}`),
        fetch(`/api/admin/exceptions`),
      ]);
      if (filtered.ok) setItems(await filtered.json());
      if (all.ok) setAllItems(await all.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    const socket = io();
    socket.on("exception_created", load);
    socket.on("exception_updated", load);
    return () => { socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const updateException = async (id: number, patch: any) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/exceptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        toast(patch.status === "resolved" ? "Exception resolved" : patch.status === "acknowledged" ? "Exception acknowledged" : "Updated", "success");
        setExpandedId(null);
        setNotesDraft("");
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "Failed to update exception", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBusyId(null);
  };

  const bulkResolve = async () => {
    if (selected.length === 0) return;
    if (!confirm(`Resolve ${selected.length} exception(s)?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/admin/exceptions/bulk-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      if (res.ok) {
        const data = await res.json();
        toast(`Resolved ${data.resolved} exception(s)`, "success");
        setSelected([]);
        load();
      } else {
        toast("Bulk resolve failed", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBulkBusy(false);
  };

  const toggleSelected = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const counts = {
    open: allItems.filter((i) => i.status === "open").length,
    critical: allItems.filter((i) => i.severity === "critical" && i.status !== "resolved").length,
  };

  const typeCounts: Record<string, number> = {};
  for (const i of allItems) typeCounts[i.exception_type] = (typeCounts[i.exception_type] || 0) + 1;
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldAlert className="text-indigo-600" size={26} /> Exception Center
          </h1>
          <p className="text-slate-500 font-medium">Every detected operational exception, with a real owner and resolution trail — blacklist blocks, seal mismatches, reefer alerts, SLA breaches, no-shows.</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 flex items-center gap-2">
            <Clock size={14} className="text-amber-600" /> {counts.open} open
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-600" /> {counts.critical} critical
          </div>
        </div>
      </div>

      {topTypes.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Top types</span>
          {topTypes.map(([type, n]) => (
            <span key={type} className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-slate-600">
              {type.replace(/_/g, " ")} <span className="text-slate-400">· {n}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        {["open", "acknowledged", "resolved", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${statusFilter === s ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-500 hover:border-indigo-300"}`}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
          <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-[2rem] p-16 text-center">
          <CheckCircle2 className="mx-auto text-teal-500 mb-3" size={36} />
          <p className="text-slate-500 font-medium">No {statusFilter !== "all" ? STATUS_LABELS[statusFilter]?.toLowerCase() : ""} exceptions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {selected.length > 0 && (
            <div className="flex items-center justify-between bg-indigo-600 text-white rounded-2xl px-5 py-3 sticky top-0 z-10">
              <span className="text-sm font-bold">{selected.length} selected</span>
              <div className="flex gap-3">
                <button onClick={() => setSelected([])} className="text-xs font-bold text-indigo-100 hover:text-white">Clear</button>
                <button onClick={bulkResolve} disabled={bulkBusy} className="bg-white text-indigo-600 px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-1.5">
                  {bulkBusy && <Loader2 size={12} className="animate-spin" />} Resolve selected
                </button>
              </div>
            </div>
          )}
          {items.map((ex) => (
            <div key={ex.id} className={`border rounded-2xl overflow-hidden ${SEVERITY_STYLES[ex.severity] || SEVERITY_STYLES.info}`}>
              <div className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 cursor-pointer" onClick={() => setExpandedId(expandedId === ex.id ? null : ex.id)}>
                <div className="min-w-0 flex items-center gap-3">
                  {ex.status !== "resolved" && (
                    <input
                      type="checkbox"
                      checked={selected.includes(ex.id)}
                      onChange={() => toggleSelected(ex.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-4 h-4 rounded accent-indigo-600"
                    />
                  )}
                  {ex.severity === "critical" ? <AlertTriangle size={16} className="shrink-0" /> : <Clock size={16} className="shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{ex.title}</p>
                    <p className="text-xs opacity-70">{ex.exception_type.replace(/_/g, " ")} · {timeAgo(ex.created_at)} {ex.owner?.name ? `· assigned to ${ex.owner.name}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/60">{STATUS_LABELS[ex.status]}</span>
                  <ChevronDown size={14} className={`transition-transform ${expandedId === ex.id ? "rotate-180" : ""}`} />
                </div>
              </div>
              {expandedId === ex.id && (
                <div className="px-5 pb-5 pt-1 bg-white/40 space-y-3">
                  {ex.description && <p className="text-sm">{ex.description}</p>}
                  {ex.resolution_notes && (
                    <div className="text-xs bg-white/70 rounded-lg px-3 py-2">
                      <p className="font-bold uppercase tracking-widest opacity-60 mb-0.5">Resolution notes</p>
                      <p>{ex.resolution_notes}</p>
                    </div>
                  )}
                  {ex.status !== "resolved" && (
                    <textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Resolution notes (optional)"
                      rows={2}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    />
                  )}
                  <div className="flex gap-2">
                    {ex.status === "open" && (
                      <button onClick={() => updateException(ex.id, { status: "acknowledged" })} disabled={busyId === ex.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
                        {busyId === ex.id && <Loader2 size={12} className="animate-spin" />} Acknowledge
                      </button>
                    )}
                    {ex.status !== "resolved" && (
                      <button onClick={() => updateException(ex.id, { status: "resolved", resolution_notes: notesDraft || undefined })} disabled={busyId === ex.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5">
                        {busyId === ex.id && <Loader2 size={12} className="animate-spin" />} Resolve
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
