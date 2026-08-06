import React, { useEffect, useState } from "react";
import { Warehouse, Building2, Mail, Lock, LogOut, Loader2, Truck, CalendarClock, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

export default function CarrierPortal() {
  const [checking, setChecking] = useState(true);
  const [carrier, setCarrier] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [appointments, setAppointments] = useState<any[]>([]);

  const loadDashboard = async () => {
    const meRes = await fetch("/api/carrier/me");
    if (!meRes.ok) {
      setChecking(false);
      return;
    }
    const me = await meRes.json();
    setCarrier(me.carrier);
    const [dash, appts] = await Promise.all([fetch("/api/carrier/dashboard"), fetch("/api/carrier/appointments")]);
    if (dash.ok) setStats(await dash.json());
    if (appts.ok) setAppointments(await appts.json());
    setChecking(false);
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
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{carrier.name}</h1>
              <p className="text-slate-500 text-sm">{carrier.email}</p>
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
                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {appointments.map((a) => (
                        <tr key={a.id}>
                          <td className="px-6 py-3 text-sm font-bold text-slate-800">{a.plate}</td>
                          <td className="px-6 py-3 text-sm text-slate-600">{a.start_time ? new Date(a.start_time).toLocaleString() : "—"}</td>
                          <td className="px-6 py-3 text-sm text-slate-600">{a.dock_name || "—"}</td>
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
