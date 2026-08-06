import React, { useEffect, useState } from "react";
import { Warehouse, Truck, Phone, KeyRound, LogOut, Loader2, Clock, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";

export default function DriverPortal() {
  const [checking, setChecking] = useState(true);
  const [driver, setDriver] = useState<any>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<{ appointments: any[]; walkins: any[] }>({ appointments: [], walkins: [] });

  const loadDashboard = async () => {
    const meRes = await fetch("/api/driver/me");
    if (!meRes.ok) {
      setChecking(false);
      return;
    }
    const me = await meRes.json();
    setDriver(me.driver);
    const apptRes = await fetch("/api/driver/appointments");
    if (apptRes.ok) setData(await apptRes.json());
    setChecking(false);
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/driver/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    setBusy(false);
    if (res.ok) setStep("code");
    else setError("Couldn't send code. Check the phone number and try again.");
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/driver/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    setBusy(false);
    if (res.ok) {
      await loadDashboard();
    } else {
      setError("Invalid or expired code.");
    }
  };

  const logout = async () => {
    await fetch("/api/driver/logout", { method: "POST" });
    setDriver(null);
    setStep("phone");
    setPhone("");
    setCode("");
    setData({ appointments: [], walkins: [] });
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
      <header className="p-6 flex justify-between items-center max-w-3xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <Warehouse className="text-indigo-600 w-7 h-7" />
          <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Driver</span>
        </Link>
        {driver && (
          <button onClick={logout} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-red-600 transition-colors">
            <LogOut size={14} /> Log out
          </button>
        )}
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-6">
        {!driver ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-sm mx-auto mt-12 bg-white border border-slate-100 rounded-3xl p-8 shadow-xl shadow-slate-100">
            <div className="flex justify-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Truck size={24} />
              </div>
            </div>
            <h1 className="text-xl font-bold text-center text-slate-900 mb-1">Driver check-in</h1>
            <p className="text-sm text-slate-500 text-center mb-6">Verify with your phone number to view your bookings and gate status.</p>

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 mb-4">{error}</p>}

            {step === "phone" ? (
              <form onSubmit={requestOtp} className="space-y-4">
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+46 70 123 4567" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                </div>
                <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy && <Loader2 size={16} className="animate-spin" />} Send code
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <div className="relative">
                  <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 tracking-widest" />
                </div>
                <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy && <Loader2 size={16} className="animate-spin" />} Verify & sign in
                </button>
                <button type="button" onClick={() => setStep("phone")} className="w-full text-xs font-semibold text-slate-400 hover:text-slate-600">
                  Use a different number
                </button>
              </form>
            )}
          </motion.div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white border border-slate-100 rounded-3xl p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Signed in as</p>
              <p className="text-lg font-bold text-slate-900">{driver.name || driver.phone}</p>
            </div>

            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Your bookings</h2>
              <div className="space-y-3">
                {data.appointments.length === 0 && <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-2xl p-6 text-center">No appointments on file yet.</p>}
                {data.appointments.map((a) => (
                  <div key={a.id} className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900">{a.plate}</p>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${a.status === "CHECKED_IN" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"}`}>{a.status}</span>
                      </div>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        <Clock size={12} /> {a.start_time ? new Date(a.start_time).toLocaleString() : "TBD"} {a.dock_name ? `· ${a.dock_name}` : ""}
                      </p>
                    </div>
                    <QRCodeSVG value={`APT-${a.id}`} size={56} level="M" />
                  </div>
                ))}
              </div>
            </div>

            {data.walkins.length > 0 && (
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Walk-in history</h2>
                <div className="space-y-3">
                  {data.walkins.map((w) => (
                    <div key={w.id} className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-bold text-slate-900">{w.truck_plate}</p>
                        <p className="text-xs text-slate-500">{w.carrier_name}</p>
                      </div>
                      <span className="text-xs font-bold flex items-center gap-1 text-teal-700">
                        {w.status === "checked_in" && <CheckCircle2 size={14} />} {w.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
