import React, { useEffect, useState } from "react";
import { FileText, Upload, Loader2, CheckCircle2, XCircle, Clock, Download, Trash2, ChevronDown, X } from "lucide-react";
import { io } from "socket.io-client";
import { useToast } from "../contexts/ToastContext";

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-slate-50 border-slate-200 text-slate-600",
  under_review: "bg-amber-50 border-amber-200 text-amber-700",
  verified: "bg-teal-50 border-teal-200 text-teal-700",
  rejected: "bg-red-50 border-red-200 text-red-700",
  expired: "bg-red-50 border-red-200 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  under_review: "Under review",
  verified: "Verified",
  rejected: "Rejected",
  expired: "Expired",
};

const ENTITY_TYPES = ["appointment", "driver", "trailer", "carrier", "vehicle", "shipment"];
const DOC_TYPES = ["Bill of Lading", "CMR", "Delivery note", "Packing list", "Purchase order", "Proof of delivery", "Driver ID", "Vehicle registration", "Insurance", "Inspection certificate", "Customs documentation", "Dangerous goods documentation", "Temperature record", "Seal documentation", "Cargo manifest", "Other"];

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isExpiringSoon(dateStr: string | null) {
  if (!dateStr) return false;
  const days = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days <= 30;
}

export default function DocumentCenter() {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [form, setForm] = useState({ doc_type: "Bill of Lading", doc_number: "", related_entity_type: "trailer", related_entity_id: "", expiry_date: "" });
  const [file, setFile] = useState<File | null>(null);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/documents?${params}`);
      if (res.ok) setItems(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    const socket = io();
    socket.on("document_uploaded", load);
    socket.on("document_updated", load);
    return () => { socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !form.related_entity_id.trim()) return;
    setUploadBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      Object.entries(form).forEach(([k, v]) => body.append(k, String(v)));
      const res = await fetch("/api/documents", { method: "POST", body });
      if (res.ok) {
        toast("Document uploaded", "success");
        setShowUpload(false);
        setFile(null);
        setForm({ doc_type: "Bill of Lading", doc_number: "", related_entity_type: "trailer", related_entity_id: "", expiry_date: "" });
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "Upload failed", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setUploadBusy(false);
  };

  const updateDoc = async (id: number, patch: any) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        toast(patch.verification_status === "verified" ? "Document verified" : patch.verification_status === "rejected" ? "Document rejected" : "Updated", "success");
        load();
      } else {
        toast("Failed to update document", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBusyId(null);
  };

  const downloadDoc = async (id: number) => {
    const res = await fetch(`/api/documents/${id}/download`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, "_blank");
    } else {
      toast("Failed to generate download link", "error");
    }
  };

  const deleteDoc = async (id: number) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (res.ok) { toast("Document deleted", "success"); load(); }
  };

  const expiringCount = items.filter((d) => isExpiringSoon(d.expiry_date)).length;

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileText className="text-indigo-600" size={26} /> Document Center
          </h1>
          <p className="text-slate-500 font-medium">Bills of lading, CMRs, insurance, inspections, and more — linked to appointments, drivers, trailers, carriers, and vehicles, with verification and expiry tracking.</p>
        </div>
        <div className="flex gap-3">
          {expiringCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm font-bold text-amber-700 flex items-center gap-2">
              <Clock size={14} /> {expiringCount} expiring soon
            </div>
          )}
          <button onClick={() => setShowUpload(true)} className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all flex items-center gap-2">
            <Upload size={14} /> Upload document
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        {["all", "uploaded", "under_review", "verified", "rejected", "expired"].map((s) => (
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
          <FileText className="mx-auto text-slate-300 mb-3" size={36} />
          <p className="text-slate-500 font-medium">No documents{statusFilter !== "all" ? ` with status "${STATUS_LABELS[statusFilter]}"` : ""}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((doc) => (
            <div key={doc.id} className={`border rounded-2xl overflow-hidden ${STATUS_STYLES[doc.verification_status] || STATUS_STYLES.uploaded}`}>
              <button onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)} className="w-full text-left px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex items-center gap-3">
                  <FileText size={16} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{doc.doc_type}{doc.doc_number ? ` — ${doc.doc_number}` : ""}</p>
                    <p className="text-xs opacity-70">{doc.related_entity_type} · {doc.related_entity_id} · {timeAgo(doc.created_at)} {doc.uploader?.name ? `· by ${doc.uploader.name}` : ""} {isExpiringSoon(doc.expiry_date) ? `· expires ${doc.expiry_date}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/60">{STATUS_LABELS[doc.verification_status]}</span>
                  <ChevronDown size={14} className={`transition-transform ${expandedId === doc.id ? "rotate-180" : ""}`} />
                </div>
              </button>
              {expandedId === doc.id && (
                <div className="px-5 pb-5 pt-1 bg-white/40 space-y-3">
                  <p className="text-xs">{doc.original_filename} · {(doc.file_size_bytes / 1024).toFixed(0)} KB</p>
                  {doc.notes && <p className="text-xs bg-white/70 rounded-lg px-3 py-2">{doc.notes}</p>}
                  {doc.verifier?.name && <p className="text-xs opacity-70">{STATUS_LABELS[doc.verification_status]} by {doc.verifier.name}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => downloadDoc(doc.id)} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
                      <Download size={12} /> Download
                    </button>
                    {doc.verification_status !== "verified" && (
                      <button onClick={() => updateDoc(doc.id, { verification_status: "verified" })} disabled={busyId === doc.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5">
                        {busyId === doc.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Verify
                      </button>
                    )}
                    {doc.verification_status !== "rejected" && (
                      <button onClick={() => updateDoc(doc.id, { verification_status: "rejected" })} disabled={busyId === doc.id} className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
                        {busyId === doc.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Reject
                      </button>
                    )}
                    <button onClick={() => deleteDoc(doc.id)} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5 ml-auto">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={() => setShowUpload(false)}>
          <form onSubmit={submitUpload} className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Upload document</h3>
              <button type="button" onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Document type</label>
                <select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Document number (optional)</label>
                <input value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Related to</label>
                <select value={form.related_entity_type} onChange={(e) => setForm({ ...form, related_entity_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm">
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Plate / ID / reference</label>
                <input required value={form.related_entity_id} onChange={(e) => setForm({ ...form, related_entity_id: e.target.value })} placeholder="e.g. ABC123" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Expiry date (optional)</label>
              <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">File (PDF, JPEG, PNG, or WEBP — max 10MB)</label>
              <input required type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={uploadBusy || !file} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {uploadBusy && <Loader2 size={14} className="animate-spin" />} Upload
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
