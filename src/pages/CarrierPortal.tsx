import React, { useEffect, useState } from "react";
import { Warehouse, Building2, Mail, Lock, LogOut, Loader2, Truck, CalendarClock, AlertCircle, Gauge, TrendingUp, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import NotificationBell from "../components/NotificationBell";

export default function CarrierPortal() {
  const [checking, setChecking] = useState(true);
  const [carrier, setCarrier] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [appointments, setAppointments] = useState<any[]>([]);
  const [detention, setDetention] = useState<any[]>([]);
  const [disputingId, setDisputingId] = useState<number | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const CARGO_TYPES = ["Pallets", "Boxes", "Shipping container", "Other"];
  const LOAD_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];
  const [requestForm, setRequestForm] = useState({ plate: "", personal_id_number: "", cargo_type: "", cargo_quantity: "", load_type: "standard" });
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState(false);

  const submitBookingRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError("");
    setRequestSuccess(false);
    setRequestBusy(true);
    const res = await fetch("/api/carrier/booking-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestForm),
    });
    setRequestBusy(false);
    if (res.ok) {
      setRequestSuccess(true);
      setRequestForm({ plate: "", personal_id_number: "", cargo_type: "", cargo_quantity: "", load_type: "standard" });
      loadDashboard();
    } else {
      const d = await res.json().catch(() => ({}));
      setRequestError(d.error || "Failed to submit request");
    }
  };

  const loadDashboard = async () => {
    const meRes = await fetch("/api/carrier/me");
    if (!meRes.ok) {
      setChecking(false);
      return;
    }
    const me = await meRes.json();
    setCarrier(me.carrier);
    const [dash, appts, det] = await Promise.all([fetch("/api/carrier/dashboard"), fetch("/api/carrier/appointments"), fetch("/api/carrier/detention")]);
    if (dash.ok) setStats(await dash.json());
    if (appts.ok) setAppointments(await appts.json());
    if (det.ok) setDetention(await det.json());
    setChecking(false);
  };

  const submitDispute = async (id: number) => {
    if (!disputeReason.trim()) return;
    setDisputeBusy(true);
    const res = await fetch(`/api/carrier/detention/${id}/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: disputeReason }),
    });
    setDisputeBusy(false);
    if (res.ok) {
      setDisputingId(null);
      setDisputeReason("");
      loadDashboard();
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/carrier/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) await loadDashboard();
    else setError(data.error || "Invalid credentials");
  };

  const logout = async () => {
    await fetch("/api/carrier/logout", { method: "POST" });
    setCarrier(null);
    setEmail("");
    setPassword("");
    setAppointments([]);
    setStats({});
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="p-6 flex justify-between items-center max-w-5xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <Warehouse className="text-indigo-600 w-7 h-7" />
          <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Carrier Portal</span>
        </Link>
        {carrier && (
          <button onClick={logout} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-red-600 transition-colors">
            <LogOut size={14} /> Log out
          </button>
        )}
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-6">
        {!carrier ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-sm mx-auto mt-12 bg-white border border-slate-100 rounded-3xl p-8 shadow-xl shadow-slate-100">
            <div className="flex justify-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Building2 size={24} />
              </div>
            </div>
            <h1 className="text-xl font-bold text-center text-slate-900 mb-1">Carrier sign-in</h1>
            <p className="text-sm text-slate-500 text-center mb-6">Track your trucks, appointments, and balances.</p>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2">
                <AlertCircle size={14} /> {error}
              </p>
            )}

            <form onSubmit={login} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@carrier.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
              <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={16} className="animate-spin" />} Sign in
              </button>
            </form>
            <p className="text-xs text-slate-400 text-center mt-6">Don't have an account? Ask your terminal admin for a booking link or portal invite.</p>
          </motion.div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{carrier.name}</h1>
                <p className="text-slate-500 text-sm">{carrier.email}</p>
              </div>
              <NotificationBell scope="carrier" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-slate-100 rounded-2xl p-6">
                <Truck className="text-indigo-600 mb-3" size={20} />
                <p className="text-3xl font-bold text-slate-900">{stats.activeTrucks ?? 0}</p>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Active trucks</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-6">
                <CalendarClock className="text-teal-600 mb-3" size={20} />
                <p className="text-3xl font-bold text-slate-900">{stats.todayAppts ?? 0}</p>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Appointments today</p>
              </div>
            </div>

            {stats.kpis && stats.kpis.totalAppointments > 0 && (
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Performance (last {stats.kpis.periodDays} days · {stats.kpis.totalAppointments} appointments)</h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-slate-100 rounded-2xl p-6">
                    <TrendingUp className="text-emerald-600 mb-3" size={20} />
                    <p className="text-3xl font-bold text-slate-900">{stats.kpis.onTimeRate != null ? `${stats.kpis.onTimeRate}%` : "—"}</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">On-time arrival</p>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-2xl p-6">
                    <XCircle className="text-rose-600 mb-3" size={20} />
                    <p className="text-3xl font-bold text-slate-900">{stats.kpis.noShowRate}%</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">No-show rate</p>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-2xl p-6">
                    <Gauge className="text-indigo-600 mb-3" size={20} />
                    <p className="text-3xl font-bold text-slate-900">{stats.kpis.complianceRate}%</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Appointment compliance</p>
                  </div>
                </div>
              </div>
            )}

            {detention.length > 0 && (
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Detention charges</h2>
                <div className="space-y-3">
                  {detention.map((d) => (
                    <div key={d.id} className="bg-white border border-slate-100 rounded-2xl p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-bold text-slate-900">{d.amount_owed} owed — {d.overtime_minutes} min over a {d.threshold_minutes}-min free window</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {new Date(d.start_time).toLocaleString()} · {d.actual_minutes} min on site · {d.rate_per_hour}/hr rate
                          </p>
                        </div>
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                          d.dispute_status === "disputed" ? "bg-amber-100 text-amber-700"
                          : d.dispute_status === "waived" ? "bg-teal-100 text-teal-700"
                          : d.dispute_status === "upheld" ? "bg-slate-100 text-slate-600"
                          : "bg-slate-50 text-slate-400"
                        }`}>
                          {d.dispute_status === "none" ? "Not disputed" : d.dispute_status}
                        </span>
                      </div>

                      {d.dispute_status === "none" && disputingId !== d.id && (
                        <button onClick={() => { setDisputingId(d.id); setDisputeReason(""); }} className="mt-3 text-xs font-bold text-indigo-600 hover:text-indigo-800">
                          Dispute this charge
                        </button>
                      )}
                      {disputingId === d.id && (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={disputeReason}
                            onChange={(e) => setDisputeReason(e.target.value.slice(0, 1000))}
                            placeholder="Explain why this charge is incorrect — e.g. gate was closed, dock unavailable, timestamp is wrong"
                            rows={2}
                            maxLength={1000}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none"
                          />
                          <div className="flex gap-2">
                            <button onClick={() => setDisputingId(null)} className="text-xs font-bold text-slate-500 px-3 py-1.5">Cancel</button>
                            <button onClick={() => submitDispute(d.id)} disabled={disputeBusy || !disputeReason.trim()} className="text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                              {disputeBusy && <Loader2 size={12} className="animate-spin" />} Submit dispute
                            </button>
                          </div>
                        </div>
                      )}
                      {d.dispute_status === "disputed" && d.dispute_reason && (
                        <p className="text-xs text-slate-500 mt-2 italic">Your dispute: "{d.dispute_reason}"</p>
                      )}
                      {(d.dispute_status === "upheld" || d.dispute_status === "waived") && d.dispute_resolution_notes && (
                        <p className="text-xs text-slate-500 mt-2">Resolution: {d.dispute_resolution_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm mb-6">
              <h3 className="font-bold text-slate-900 text-lg mb-1">Request a booking</h3>
              <p className="text-slate-500 text-sm mb-4">Tell us what's coming — an admin will place it on the schedule and you'll be notified.</p>
              {requestSuccess && (
                <div className="bg-teal-50 border border-teal-200 text-teal-700 rounded-xl px-4 py-2.5 text-sm font-bold mb-4">
                  Request submitted — you'll be notified once it's scheduled.
                </div>
              )}
              {requestError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-2.5 text-sm font-bold mb-4">{requestError}</div>
              )}
              <form onSubmit={submitBookingRequest} className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Vehicle plate</label>
                  <input required value={requestForm.plate} onChange={(e) => setRequestForm({ ...requestForm, plate: e.target.value.toUpperCase() })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Driver personal ID number</label>
                  <input required value={requestForm.personal_id_number} onChange={(e) => setRequestForm({ ...requestForm, personal_id_number: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Load type</label>
                  <select value={requestForm.load_type} onChange={(e) => setRequestForm({ ...requestForm, load_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
                    {LOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Cargo type</label>
                  <select required value={requestForm.cargo_type} onChange={(e) => setRequestForm({ ...requestForm, cargo_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
                    <option value="">Select...</option>
                    {CARGO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {requestForm.cargo_type && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Quantity</label>
                    <input value={requestForm.cargo_quantity} onChange={(e) => setRequestForm({ ...requestForm, cargo_quantity: e.target.value })} placeholder="e.g. 24" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm" />
                  </div>
                )}
                <div className="col-span-2">
                  <button type="submit" disabled={requestBusy} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
                    {requestBusy && <Loader2 size={14} className="animate-spin" />} Submit request
                  </button>
                </div>
              </form>
            </div>

            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Appointment history</h2>
              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
                {appointments.length === 0 ? (
                  <p className="text-sm text-slate-400 p-8 text-center">No appointments yet.</p>
                ) : (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Plate</th>
                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Time</th>
                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Dock</th>
                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Trailer</th>
                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {appointments.map((a) => (
                        <tr key={a.id}>
                          <td className="px-6 py-3 text-sm font-bold text-slate-800">{a.plate}</td>
                          <td className="px-6 py-3 text-sm text-slate-600">{a.start_time ? new Date(a.start_time).toLocaleString() : "—"}</td>
                          <td className="px-6 py-3 text-sm text-slate-600">{a.dock_name || "—"}</td>
                          <td className="px-6 py-3">
                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${a.trailer_status === "AT_DOCK" ? "bg-indigo-100 text-indigo-700" : a.trailer_status === "IN_YARD" ? "bg-teal-100 text-teal-700" : a.trailer_status === "DEPARTED" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                              {a.trailer_status_detail}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-sm font-semibold text-indigo-600">{a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
