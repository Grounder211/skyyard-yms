import React, { useEffect, useMemo, useState } from "react";
import {
  Truck,
  ScanLine,
  Search,
  UserCheck,
  UserPlus,
  DoorOpen,
  ShieldAlert,
  CheckCircle2,
  Clock,
  X,
  LogOut,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "../contexts/ToastContext";
import QRScanner from "../components/QRScanner";

const LOAD_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];
const DIRECTIONS = ["INBOUND", "OUTBOUND"];

export default function GateConsole() {
  const { toast } = useToast();
  const [yard, setYard] = useState<any>({ stats: {}, spots: [], appointments: [] });
  const [visitors, setVisitors] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [weather, setWeather] = useState<any>(null);
  useEffect(() => {
    const loadWeather = () => fetch("/api/weather/current").then((r) => (r.ok ? r.json() : null)).then(setWeather).catch(() => {});
    loadWeather();
    const t = setInterval(loadWeather, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const [checkinTarget, setCheckinTarget] = useState<any>(null);
  const [checkinForm, setCheckinForm] = useState({ plate: "", carrierName: "", sealNumber: "" });
  const [discrepancy, setDiscrepancy] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const [walkinForm, setWalkinForm] = useState({
    driver_name: "",
    carrier_name: "",
    phone: "",
    truck_plate: "",
    trailer_number: "",
    load_type: "standard",
    direction: "INBOUND",
  });
  const [walkinResult, setWalkinResult] = useState<any>(null);

  const [visitorForm, setVisitorForm] = useState({ name: "", company: "", host_name: "", purpose: "", expected_duration: 60 });
  const [visitorResult, setVisitorResult] = useState<any>(null);

  const loadYard = async () => {
    try {
      const res = await fetch("/api/yard-status");
      setYard(await res.json());
    } catch {}
    setLoading(false);
  };

  const loadVisitors = async () => {
    try {
      const res = await fetch("/api/visitors/active");
      setVisitors(await res.json());
    } catch {}
  };

  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [approvalBusy, setApprovalBusy] = useState<number | null>(null);

  const loadPendingApprovals = async () => {
    try {
      const res = await fetch("/api/admin/walkin/pending");
      if (res.ok) setPendingApprovals(await res.json());
    } catch {}
  };

  const approveEntry = async (id: number) => {
    setApprovalBusy(id);
    const res = await fetch(`/api/admin/walkin/${id}/approve`, { method: "POST" });
    setApprovalBusy(null);
    if (res.ok) {
      const data = await res.json();
      toast(data.spotName ? `Approved — assigned to ${data.spotName}` : "Approved — queued, yard full", "success");
      loadPendingApprovals();
    } else {
      toast("Failed to approve", "error");
    }
  };

  const rejectEntry = async (id: number) => {
    const reason = window.prompt("Reason for denying entry (shown to driver):") || "";
    setApprovalBusy(id);
    const res = await fetch(`/api/admin/walkin/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setApprovalBusy(null);
    if (res.ok) {
      toast("Entry denied", "success");
      loadPendingApprovals();
    } else {
      toast("Failed to reject", "error");
    }
  };

  useEffect(() => {
    loadYard();
    loadVisitors();
    loadPendingApprovals();
    const socket = io();
    socket.on("yard_update", () => {
      loadYard();
      loadVisitors();
      loadPendingApprovals();
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const availableParking = (yard.spots || []).filter((s: any) => s.type === "PARKING" && s.status === "EMPTY").length;
  const availableDocks = (yard.spots || []).filter((s: any) => s.type === "DOCK" && s.status === "EMPTY").length;

  const scheduledToday = useMemo(() => {
    const list = (yard.appointments || []) as any[];
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((a) => (a.plate || "").toLowerCase().includes(q) || (a.carrier || "").toLowerCase().includes(q) || String(a.id).includes(q));
  }, [yard.appointments, query]);

  const openCheckin = (appt: any) => {
    setCheckinTarget(appt);
    setCheckinForm({ plate: appt.plate || "", carrierName: appt.carrier || "", sealNumber: "" });
    setDiscrepancy(null);
  };

  const handleScan = (text: string) => {
    setScanOpen(false);
    // QR payload format: APT-<id>-<plate>
    const match = text.match(/APT-(\d+)/i);
    if (match) {
      const id = match[1];
      setQuery(id);
      const found = (yard.appointments || []).find((a: any) => String(a.id) === id);
      if (found) openCheckin(found);
      else toast(`No scheduled appointment found for reference ${text}`, "warning");
    } else {
      setQuery(text);
      toast("Scanned code doesn't match an appointment reference — showing as search text.", "info");
    }
  };

  const submitCheckin = async (overrideDiscrepancy = false) => {
    if (!checkinTarget) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gate/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: checkinTarget.id,
          plate: checkinForm.plate,
          carrierName: checkinForm.carrierName,
          sealNumber: checkinForm.sealNumber || undefined,
          overrideDiscrepancy,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setDiscrepancy(data);
        setBusy(false);
        return;
      }
      if (res.status === 403) {
        toast(`Blocked: ${data.reason || "carrier/plate is blacklisted"}`, "error");
        setBusy(false);
        return;
      }
      if (!res.ok) {
        toast(data.error || "Check-in failed", "error");
        setBusy(false);
        return;
      }
      toast(`Checked in — assigned to ${data.spotName}`, "success");
      setCheckinTarget(null);
      setDiscrepancy(null);
      loadYard();
    } catch {
      toast("Network error during check-in", "error");
    }
    setBusy(false);
  };

  const submitWalkin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/walkin/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(walkinForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Registration failed", "error");
      } else {
        setWalkinResult(data);
        if (data.status === "QUEUED") {
          toast("Yard is full — driver queued and the manager has been notified.", "warning");
        } else {
          toast(`Registered — assigned to ${data.spotName}`, "success");
        }
        setWalkinForm({ driver_name: "", carrier_name: "", phone: "", truck_plate: "", trailer_number: "", load_type: "standard", direction: "INBOUND" });
        loadYard();
      }
    } catch {
      toast("Network error during registration", "error");
    }
    setBusy(false);
  };

  const submitVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/visitors/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visitorForm),
      });
      const data = await res.json();
      if (res.ok) {
        setVisitorResult(data);
        setVisitorForm({ name: "", company: "", host_name: "", purpose: "", expected_duration: 60 });
        loadVisitors();
        toast(`Visitor registered — access code ${data.accessCode}`, "success");
      } else {
        toast(data.error || "Visitor registration failed", "error");
      }
    } catch {
      toast("Network error", "error");
    }
    setBusy(false);
  };

  const checkoutVisitor = async (accessCode: string) => {
    const res = await fetch("/api/visitors/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode }),
    });
    if (res.ok) {
      toast("Visitor checked out", "success");
      loadVisitors();
    } else {
      toast("Checkout failed", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-xs font-bold uppercase tracking-widest">Loading gate console...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Gate & Check-in</h1>
          <p className="text-slate-500 font-medium">Verify scheduled arrivals, register walk-ins, and manage visitors on-site.</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 flex items-center gap-2">
            <DoorOpen size={16} className="text-teal-600" /> {availableDocks} docks free
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 flex items-center gap-2">
            <Truck size={16} className="text-indigo-600" /> {availableParking} parking free
          </div>
        </div>
      </div>

      {weather?.icyRisk && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-300 text-red-700 rounded-2xl px-5 py-3 font-bold text-sm" role="alert">
          <AlertTriangle size={18} className="shrink-0" />
          <span>Icy conditions — {weather.tempC}°C at {weather.stationName}. Use caution moving trailers on the yard surface.</span>
        </div>
      )}

      {pendingApprovals.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-700 flex items-center gap-1.5">
            <UserCheck size={13} /> Gate entry awaiting approval ({pendingApprovals.length})
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((w: any) => (
              <div key={w.id} className="bg-white border border-indigo-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-sm truncate">{w.truck_plate} — {w.carrier_name}</p>
                  <p className="text-xs text-slate-400">{w.driver_name} · {w.load_type} · WK-{w.id} · {new Date(w.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => rejectEntry(w.id)}
                    disabled={approvalBusy === w.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 transition-all disabled:opacity-50"
                  >
                    Deny
                  </button>
                  <button
                    onClick={() => approveEntry(w.id)}
                    disabled={approvalBusy === w.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-1"
                  >
                    {approvalBusy === w.id && <Loader2 size={11} className="animate-spin" />} Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search / Scan bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by plate, carrier, or appointment ref..."
            className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>
        <button
          onClick={() => setScanOpen(true)}
          className="bg-indigo-600 text-white px-5 py-3 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2 shrink-0"
        >
          <ScanLine size={16} /> Scan QR
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Scheduled arrivals */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <Clock size={18} className="text-indigo-600" /> Scheduled arrivals today
            </h3>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{scheduledToday.length} total</span>
          </div>
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {scheduledToday.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">No scheduled appointments match.</p>}
            {scheduledToday.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 transition-all">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-900 truncate">{a.plate}</p>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        a.status === "CHECKED_IN" ? "bg-teal-100 text-teal-700" : a.status === "SCHEDULED" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {a.carrier} &middot; {new Date(a.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} &middot; Ref APT-{a.id}
                  </p>
                </div>
                <button
                  onClick={() => openCheckin(a)}
                  disabled={a.status === "CHECKED_IN"}
                  className="shrink-0 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <UserCheck size={14} /> {a.status === "CHECKED_IN" ? "Checked in" : "Check in"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Active visitors */}
        <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
          <h3 className="font-bold text-slate-900 text-lg mb-6 flex items-center gap-2">
            <UserCheck size={18} className="text-teal-600" /> Active visitors
          </h3>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 mb-6">
            {visitors.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No visitors on-site.</p>}
            {visitors.map((v: any) => (
              <div key={v.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{v.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{v.company} &middot; visiting {v.host_name}</p>
                </div>
                <button
                  onClick={() => checkoutVisitor(v.access_code)}
                  className="shrink-0 text-red-600 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                  title="Check out"
                >
                  <LogOut size={14} />
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={submitVisitor} className="space-y-2 pt-4 border-t border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Register visitor</p>
            <input required placeholder="Full name" value={visitorForm.name} onChange={(e) => setVisitorForm({ ...visitorForm, name: e.target.value })} className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            <input placeholder="Company" value={visitorForm.company} onChange={(e) => setVisitorForm({ ...visitorForm, company: e.target.value })} className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            <input required placeholder="Host / meeting with" value={visitorForm.host_name} onChange={(e) => setVisitorForm({ ...visitorForm, host_name: e.target.value })} className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            <button type="submit" disabled={busy} className="w-full bg-teal-600 text-white py-2 rounded-lg text-xs font-bold hover:bg-teal-700 transition-all disabled:opacity-50">
              Register & get access code
            </button>
          </form>

          {visitorResult && (
            <div className="mt-3 p-3 bg-teal-50 border border-teal-100 rounded-xl text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-700">Access code</p>
              <p className="text-2xl font-black text-teal-700 tracking-widest">{visitorResult.accessCode}</p>
            </div>
          )}
        </div>
      </div>

      {/* Walk-in registration */}
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-spatial">
        <h3 className="font-bold text-slate-900 text-lg mb-1 flex items-center gap-2">
          <UserPlus size={18} className="text-amber-600" /> Walk-in registration
        </h3>
        <p className="text-sm text-slate-500 mb-6">
          For drivers without a pre-booked appointment. A parking spot is assigned automatically if one is free — otherwise the driver is
          queued and the on-duty manager is notified instantly.
        </p>
        <form onSubmit={submitWalkin} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Driver name" required value={walkinForm.driver_name} onChange={(v) => setWalkinForm({ ...walkinForm, driver_name: v })} />
          <Field label="Carrier" required value={walkinForm.carrier_name} onChange={(v) => setWalkinForm({ ...walkinForm, carrier_name: v })} />
          <Field label="Phone" required value={walkinForm.phone} onChange={(v) => setWalkinForm({ ...walkinForm, phone: v })} placeholder="+46 70 123 4567" />
          <Field label="Truck plate" required value={walkinForm.truck_plate} onChange={(v) => setWalkinForm({ ...walkinForm, truck_plate: v })} />
          <Field label="Trailer number" value={walkinForm.trailer_number} onChange={(v) => setWalkinForm({ ...walkinForm, trailer_number: v })} />
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Load type</label>
            <select value={walkinForm.load_type} onChange={(e) => setWalkinForm({ ...walkinForm, load_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {LOAD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Direction</label>
            <select value={walkinForm.direction} onChange={(e) => setWalkinForm({ ...walkinForm, direction: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 flex items-end">
            <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />} Register walk-in
            </button>
          </div>
        </form>

        {walkinResult && (
          <div className="mt-6 p-6 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-6 flex-wrap">
            <QRCodeSVG value={`APT-${walkinResult.id}`} size={88} level="M" />
            <div>
              <p className="font-bold text-slate-900">Reference {walkinResult.id}</p>
              {walkinResult.spotName ? (
                <p className="text-sm text-teal-700 font-semibold flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={14} /> Assigned to {walkinResult.spotName}
                </p>
              ) : (
                <p className="text-sm text-amber-700 font-semibold flex items-center gap-1.5 mt-1">
                  <ShieldAlert size={14} /> Yard full — queued, manager notified
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1">Hand this reference / QR to the driver.</p>
            </div>
          </div>
        )}
      </div>

      {/* Check-in modal */}
      {checkinTarget && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-6" onClick={() => setCheckinTarget(null)}>
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-lg text-slate-900">Confirm check-in</h3>
              <button onClick={() => setCheckinTarget(null)} className="text-slate-400 hover:text-slate-900">
                <X size={18} />
              </button>
            </div>

            {discrepancy ? (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
                  <p className="font-bold flex items-center gap-1.5 mb-2">
                    <ShieldAlert size={14} /> Discrepancy detected
                  </p>
                  <p>
                    Expected <span className="font-mono">{discrepancy.expected?.plate}</span> / {discrepancy.expected?.carrier}
                  </p>
                  <p>
                    Presented <span className="font-mono">{discrepancy.presented?.plate}</span> / {discrepancy.presented?.carrier}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDiscrepancy(null)} className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-200">
                    Cancel
                  </button>
                  <button onClick={() => submitCheckin(true)} disabled={busy} className="flex-1 bg-amber-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
                    Override & check in
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Plate" required value={checkinForm.plate} onChange={(v) => setCheckinForm({ ...checkinForm, plate: v })} />
                <Field label="Carrier" required value={checkinForm.carrierName} onChange={(v) => setCheckinForm({ ...checkinForm, carrierName: v })} />
                <Field label="Seal number (optional)" value={checkinForm.sealNumber} onChange={(v) => setCheckinForm({ ...checkinForm, sealNumber: v })} />
                <button
                  onClick={() => submitCheckin(false)}
                  disabled={busy}
                  className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />} Confirm & assign spot
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {scanOpen && <QRScanner onDetect={handleScan} onClose={() => setScanOpen(false)} />}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</label>
      <input
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
      />
    </div>
  );
}
