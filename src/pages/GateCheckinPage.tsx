import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Warehouse, KeyRound, Loader2, Truck, CheckCircle2, IdCard } from "lucide-react";
import PhoneInput, { toE164 } from "../components/PhoneInput";

const LOAD_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];
const DIRECTIONS = ["INBOUND", "OUTBOUND"];
const CARGO_TYPES = ["Pallets", "Boxes", "Shipping container", "Other"];

// Public, unauthenticated-by-staff self check-in form (direct link, not the
// gate QR — the physical QR at the gate points at /kiosk/:facilityId /
// KioskCheckinPage instead). No guard reviews this in person, so identity is
// established by OTP (driver phone verification) — see requireDriverAuth on
// the backend.
export default function GateCheckinPage() {
  const { facilityId = "1" } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState<"phone" | "code" | "form">("phone");
  const [countryCode, setCountryCode] = useState("+46");
  const [nationalNumber, setNationalNumber] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    truck_plate: "", carrier_name: "", trailer_number: "", load_type: "standard",
    direction: "INBOUND", consent: false, website: "", // website = honeypot, never shown
    po_number: "", sku_summary: "", personal_id_number: "", terms_accepted: false,
    cargo_type: "", cargo_quantity: "",
  });
  // Accepting is gated on actually reaching the bottom of the terms — a
  // checkbox alone is trivially clicked past without reading.
  const [termsScrolled, setTermsScrolled] = useState(false);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/driver/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: toE164(countryCode, nationalNumber) }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      // No SMS provider configured — the backend already established the
      // session instead of issuing a code nobody could receive.
      setStep(data.skippedOtp ? "form" : "code");
    } else {
      setError("Couldn't send code. Check the phone number and try again.");
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/driver/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: toE164(countryCode, nationalNumber), code }),
    });
    setBusy(false);
    if (res.ok) setStep("form");
    else setError("Invalid or expired code.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.consent) {
      setError("Please confirm you consent to data processing to continue.");
      return;
    }
    if (!form.terms_accepted) {
      setError("Please read and accept the terms and safety guidelines to continue.");
      return;
    }
    setError("");
    setBusy(true);
    const res = await fetch("/api/public/walkin-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, facility_id: Number(facilityId) }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      navigate(`/gate-checkin/status/${data.status_token}`);
    } else if (data.status_token) {
      navigate(`/gate-checkin/status/${data.status_token}`);
    } else {
      setError(data.error || "Registration failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="p-6 flex items-center gap-2 max-w-lg mx-auto w-full">
        <Warehouse className="text-indigo-600 w-7 h-7" />
        <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Gate</span>
      </header>

      <main className="flex-1 flex items-start justify-center px-6 pb-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-sm mt-4">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Gate Check-in</h1>
          <p className="text-slate-500 text-sm mb-6">Verify your phone, then tell us why you're here. An admin will review and let you in.</p>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4">{error}</p>}

          {step === "phone" && (
            <form onSubmit={requestOtp} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Phone number</label>
                <PhoneInput countryCode={countryCode} number={nationalNumber} onChange={(cc, n) => { setCountryCode(cc); setNationalNumber(n); }} required />
              </div>
              <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Send code
              </button>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={verifyOtp} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><KeyRound size={12} /> Verification code</label>
                <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
              <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Verify
              </button>
            </form>
          )}

          {step === "form" && (
            <form onSubmit={submit} className="space-y-4">
              <div className="flex items-center gap-2 text-teal-700 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 text-xs font-bold">
                <CheckCircle2 size={14} /> Phone verified
              </div>

              {/* Honeypot — hidden from real users via CSS, bots that fill every field trip this */}
              <input type="text" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" tabIndex={-1} autoComplete="off" />

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Truck size={12} /> Truck / trailer plate</label>
                <input required value={form.truck_plate} onChange={(e) => setForm({ ...form, truck_plate: e.target.value.toUpperCase() })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Carrier / company</label>
                <input required value={form.carrier_name} onChange={(e) => setForm({ ...form, carrier_name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><IdCard size={12} /> Personal identity number</label>
                <input required value={form.personal_id_number} onChange={(e) => setForm({ ...form, personal_id_number: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Trailer number (optional)</label>
                <input value={form.trailer_number} onChange={(e) => setForm({ ...form, trailer_number: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Load type</label>
                  <select value={form.load_type} onChange={(e) => setForm({ ...form, load_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm">
                    {LOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Direction</label>
                  <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm">
                    {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Cargo type</label>
                  <select value={form.cargo_type} onChange={(e) => setForm({ ...form, cargo_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm">
                    <option value="">Select...</option>
                    {CARGO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {form.cargo_type && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Quantity</label>
                    <input value={form.cargo_quantity} onChange={(e) => setForm({ ...form, cargo_quantity: e.target.value })} placeholder="e.g. 24" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">PO number (optional)</label>
                <input value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Cargo / SKU summary (optional)</label>
                <input value={form.sku_summary} onChange={(e) => setForm({ ...form, sku_summary: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
              </div>

              <div className="pt-2 space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Terms &amp; safety guidelines</label>
                <div
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setTermsScrolled(true);
                  }}
                  className="h-44 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 leading-relaxed space-y-3"
                >
                  {/* PLACEHOLDER — replace with this facility's real terms and
                      safety guidelines before going live. Deliberately not
                      invented here: this text is what drivers legally accept. */}
                  <p className="font-bold text-slate-700">[PLACEHOLDER — facility terms and safety guidelines go here]</p>
                  <p>This facility has not yet published its terms and safety guidelines in the system. An administrator must replace this text with the real policy before this form is used for live gate entry.</p>
                  <p>What normally belongs here: site speed limits, required personal protective equipment, permitted walking routes, trailer coupling/uncoupling rules, incident and near-miss reporting, emergency assembly points, and the facility's data retention terms.</p>
                  <p>Scroll to the end to enable acceptance.</p>
                  <p className="text-slate-400">— end of document —</p>
                </div>
                {!termsScrolled && <p className="text-[11px] text-slate-400">Scroll to the bottom of the document to continue.</p>}
                <label className={`flex items-start gap-2.5 text-xs ${termsScrolled ? "text-slate-600" : "text-slate-300"}`}>
                  <input
                    type="checkbox"
                    disabled={!termsScrolled}
                    checked={form.terms_accepted}
                    onChange={(e) => setForm({ ...form, terms_accepted: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>I have read and accept the terms and safety guidelines for entering this yard.</span>
                </label>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-500">
                <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5" />
                <span>I consent to my name, phone number, identity number, and vehicle details being processed for gate access purposes, retained per the facility's data retention policy. See <a href="/privacy" className="text-indigo-600 underline">privacy request page</a>.</span>
              </label>

              <button type="submit" disabled={busy || !form.terms_accepted || !form.consent} className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Register &amp; request entry
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
