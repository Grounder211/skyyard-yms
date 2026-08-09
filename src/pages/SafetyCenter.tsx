import React, { useEffect, useState } from "react";
import { HardHat, AlertTriangle, Clock, CheckCircle2, Loader2, ChevronDown, Plus, X } from "lucide-react";
import { io } from "socket.io-client";
import { useToast } from "../contexts/ToastContext";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-50 border-red-200 text-red-700",
  high: "bg-orange-50 border-orange-200 text-orange-700",
  medium: "bg-amber-50 border-amber-200 text-amber-700",
  low: "bg-slate-50 border-slate-200 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
};

const CATEGORY_LABELS: Record<string, string> = {
  near_miss: "Near miss",
  ppe_violation: "PPE violation",
  speed_violation: "Speed violation",
  restricted_zone_entry: "Restricted zone entry",
  pedestrian_conflict: "Pedestrian conflict",
  unauthorized_movement: "Unauthorized movement",
  collision_risk: "Collision risk",
  unsafe_parking: "Unsafe parking",
  damaged_equipment: "Damaged equipment",
  other: "Other",
};

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SafetyCenter() {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [correctiveDraft, setCorrectiveDraft] = useState("");
  const [rootCauseDraft, setRootCauseDraft] = useState("");
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [form, setForm] = useState({ severity: "medium", category: "near_miss", location: "", plate: "", description: "", witnesses: "", immediate_action: "", spot_id: "" });
  const [spots, setSpots] = useState<any[]>([]);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const [filtered, all] = await Promise.all([
        fetch(`/api/admin/safety-incidents?${params}`),
        fetch(`/api/admin/safety-incidents`),
      ]);
      if (filtered.ok) setItems(await filtered.json());
      if (all.ok) setAllItems(await all.json());
    } catch {}
    setLoading(false);
  };

  // Reuses yard-status's spot list rather than a dedicated endpoint —
  // this is the same list the yard map already renders.
  useEffect(() => {
    fetch("/api/yard-status").then((r) => r.ok ? r.json() : null).then((d) => setSpots(d?.spots || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    const socket = io();
    socket.on("safety_incident_created", load);
    socket.on("safety_incident_updated", load);
    return () => { socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;
    setReportBusy(true);
    try {
      const res = await fetch("/api/admin/safety-incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, spot_id: form.spot_id ? Number(form.spot_id) : null }),
      });
      if (res.ok) {
        toast("Safety incident reported", "success");
        setForm({ severity: "medium", category: "near_miss", location: "", plate: "", description: "", witnesses: "", immediate_action: "", spot_id: "" });
        setShowReportForm(false);
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "Failed to report incident", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setReportBusy(false);
  };

  const updateIncident = async (id: number, patch: any) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/safety-incidents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        toast(patch.status === "resolved" ? "Incident resolved" : patch.status === "investigating" ? "Marked as investigating" : "Updated", "success");
        setExpandedId(null);
        setCorrectiveDraft("");
        setRootCauseDraft("");
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "Failed to update incident", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBusyId(null);
  };

  const counts = {
    open: allItems.filter((i) => i.status === "open").length,
    critical: allItems.filter((i) => (i.severity === "critical" || i.severity === "high") && i.status !== "resolved").length,
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <HardHat className="text-indigo-600" size={26} /> Safety Center
          </h1>
          <p className="text-slate-500 font-medium">Near misses, PPE/speed violations, restricted-zone entries, damaged equipment — with severity, witnesses, root cause, and corrective action.</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 flex items-center gap-2">
            <Clock size={14} className="text-amber-600" /> {counts.open} open
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-600" /> {counts.critical} high/critical
          </div>
          <button onClick={() => setShowReportForm(true)} className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all flex items-center gap-2">
            <Plus size={14} /> Report incident
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        {["open", "investigating", "resolved", "all"].map((s) => (
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
          <p className="text-slate-500 font-medium">No {statusFilter !== "all" ? STATUS_LABELS[statusFilter]?.toLowerCase() : ""} safety incidents.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((inc) => (
            <div key={inc.id} className={`border rounded-2xl overflow-hidden ${SEVERITY_STYLES[inc.severity] || SEVERITY_STYLES.low}`}>
              <button onClick={() => setExpandedId(expandedId === inc.id ? null : inc.id)} className="w-full text-left px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex items-center gap-3">
                  <AlertTriangle size={16} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{CATEGORY_LABELS[inc.category] || inc.category}{inc.plate ? ` · ${inc.plate}` : ""}</p>
                    <p className="text-xs opacity-70">{inc.severity} · {timeAgo(inc.created_at)}{inc.location ? ` · ${inc.location}` : ""} {inc.reporter?.name ? `· reported by ${inc.reporter.name}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/60">{STATUS_LABELS[inc.status]}</span>
                  <ChevronDown size={14} className={`transition-transform ${expandedId === inc.id ? "rotate-180" : ""}`} />
                </div>
              </button>
              {expandedId === inc.id && (
                <div className="px-5 pb-5 pt-1 bg-white/40 space-y-3">
                  <p className="text-sm">{inc.description}</p>
                  {inc.witnesses && <p className="text-xs"><span className="font-bold uppercase tracking-widest opacity-60">Witnesses:</span> {inc.witnesses}</p>}
                  {inc.immediate_action && <p className="text-xs"><span className="font-bold uppercase tracking-widest opacity-60">Immediate action:</span> {inc.immediate_action}</p>}
                  {inc.driver?.name && <p className="text-xs"><span className="font-bold uppercase tracking-widest opacity-60">Driver:</span> {inc.driver.name}</p>}
                  {(inc.corrective_action || inc.root_cause) && (
                    <div className="text-xs bg-white/70 rounded-lg px-3 py-2 space-y-1">
                      {inc.root_cause && <p><span className="font-bold uppercase tracking-widest opacity-60">Root cause:</span> {inc.root_cause}</p>}
                      {inc.corrective_action && <p><span className="font-bold uppercase tracking-widest opacity-60">Corrective action:</span> {inc.corrective_action}</p>}
                    </div>
                  )}
                  {inc.status !== "resolved" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <textarea value={rootCauseDraft} onChange={(e) => setRootCauseDraft(e.target.value)} placeholder="Root cause (optional)" rows={2} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                      <textarea value={correctiveDraft} onChange={(e) => setCorrectiveDraft(e.target.value)} placeholder="Corrective action (optional)" rows={2} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                    </div>
                  )}
                  <div className="flex gap-2">
                    {inc.status === "open" && (
                      <button onClick={() => updateIncident(inc.id, { status: "investigating", root_cause: rootCauseDraft || undefined, corrective_action: correctiveDraft || undefined })} disabled={busyId === inc.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
                        {busyId === inc.id && <Loader2 size={12} className="animate-spin" />} Investigate
                      </button>
                    )}
                    {inc.status !== "resolved" && (
                      <button onClick={() => updateIncident(inc.id, { status: "resolved", root_cause: rootCauseDraft || undefined, corrective_action: correctiveDraft || undefined })} disabled={busyId === inc.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5">
                        {busyId === inc.id && <Loader2 size={12} className="animate-spin" />} Resolve
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showReportForm && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={() => setShowReportForm(false)}>
          <form onSubmit={submitReport} className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Report safety incident</h3>
              <button type="button" onClick={() => setShowReportForm(false)} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Severity</label>
                <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Yard spot (optional)</label>
                <select value={form.spot_id} onChange={(e) => setForm({ ...form, spot_id: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                  <option value="">Not at a specific spot</option>
                  {spots.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Location detail (optional)</label>
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. near the fuel island" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Related plate (optional)</label>
                <input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} placeholder="e.g. ABC123" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Description</label>
              <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Witnesses (optional)</label>
              <input value={form.witnesses} onChange={(e) => setForm({ ...form, witnesses: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Immediate action taken (optional)</label>
              <textarea value={form.immediate_action} onChange={(e) => setForm({ ...form, immediate_action: e.target.value })} rows={2} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={reportBusy} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {reportBusy && <Loader2 size={14} className="animate-spin" />} Submit report
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
