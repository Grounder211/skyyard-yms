import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Warehouse, KeyRound, Loader2, Truck, CheckCircle2, XCircle, Clock, ArrowLeft } from "lucide-react";
import PhoneInput, { toE164 } from "../components/PhoneInput";

const LOAD_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];
const DIRECTIONS = ["INBOUND", "OUTBOUND"];
const INACTIVITY_RESET_MS = 90_000;
const RESULT_RESET_MS = 20_000;

// Fullscreen, touch-first variant of GateCheckinPage for a tablet bolted to
// an unmanned gate post — same OTP -> form -> admin-review flow, but never
// navigates away (a kiosk has no "back" the next driver should see) and
// resets itself to the idle screen after a result or a period of no input,
// so one driver's session never bleeds into the next truck's.
export default function KioskCheckinPage() {
  const { facilityId = "1" } = useParams();

  const [step, setStep] = useState<"idle" | "phone" | "code" | "photo" | "form" | "result">("idle");
  const [photo, setPhoto] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [countryCode, setCountryCode] = useState("+46");
  const [nationalNumber, setNationalNumber] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);

  const [form, setForm] = useState({
    truck_plate: "", carrier_name: "", trailer_number: "", load_type: "standard",
    direction: "INBOUND", consent: false, website: "", po_number: "", sku_summary: "",
    personal_id_number: "", terms_accepted: false,
  });
  // Accepting is gated on actually reaching the bottom of the terms — a
  // checkbox alone is trivially tapped past, especially on a kiosk.
  const [termsScrolled, setTermsScrolled] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const resetAll = () => {
    stopCamera();
    setStep("idle");
    setCountryCode("+46");
    setNationalNumber("");
    setCode("");
    setPhoto(null);
    setBusy(false);
    setError("");
    setStatusToken(null);
    setStatus(null);
    setForm({ truck_plate: "", carrier_name: "", trailer_number: "", load_type: "standard", direction: "INBOUND", consent: false, website: "", po_number: "", sku_summary: "", personal_id_number: "", terms_accepted: false });
    setTermsScrolled(false);
  };

  // Camera only — never a file picker, so there's no path for a driver to
  // submit someone else's photo or a saved image instead of themselves
  // standing at the gate right now.
  useEffect(() => {
    if (step !== "photo") return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("Camera access is required to continue. Please allow camera access and try again."));
    return stopCamera;
  }, [step]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 480 * (video.videoHeight / video.videoWidth || 0.75);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.7));
    stopCamera();
  };

  // Inactivity reset — a kiosk left mid-flow (driver walked away, distracted)
  // shouldn't sit there showing the previous driver's half-filled form.
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpInactivity = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (step === "idle") return;
    inactivityTimer.current = setTimeout(resetAll, INACTIVITY_RESET_MS);
  };
  useEffect(() => {
    bumpInactivity();
    return () => { if (inactivityTimer.current) clearTimeout(inactivityTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, countryCode, nationalNumber, code, photo, form]);

  const enterKiosk = () => {
    setStep("phone");
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

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
      setStep(data.skippedOtp ? "photo" : "code");
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
    if (res.ok) setStep("photo");
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
      body: JSON.stringify({ ...form, facility_id: Number(facilityId), photo_base64: photo }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.status_token) {
      setStatusToken(data.status_token);
      setStep("result");
    } else {
      setError(data.error || "Registration failed. Please try again.");
    }
  };

  // Poll the same status endpoint the non-kiosk status page uses, but
  // inline — a kiosk driver watches the same screen, not a new page.
  useEffect(() => {
    if (step !== "result" || !statusToken) return;
    let cancelled = false;
    const poll = () => {
      fetch(`/api/public/walkin/status/${statusToken}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setStatus(d); });
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [step, statusToken]);

  // Once a final decision lands, give the driver a moment to read it, then
  // reset for the next truck automatically.
  useEffect(() => {
    if (step !== "result" || !status) return;
    if (status.status === "pending_approval" || status.status === "approved_awaiting_spot") return;
    const t = setTimeout(resetAll, RESULT_RESET_MS);
    return () => clearTimeout(t);
  }, [step, status]);

  return (
    <div onClick={bumpInactivity} onTouchStart={bumpInactivity} className="min-h-screen bg-slate-900 flex flex-col select-none">
      <header className="p-6 flex items-center gap-2.5 justify-center">
        <Warehouse className="text-indigo-400 w-9 h-9" />
        <span className="font-bold text-2xl tracking-tight text-white">SkyYard Gate</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-8 pb-12">
        {step === "idle" && (
          <button
            onClick={enterKiosk}
            className="w-full max-w-xl aspect-[4/3] bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-[3rem] flex flex-col items-center justify-center gap-6 text-white shadow-2xl transition-all"
          >
            <Truck size={96} strokeWidth={1.5} />
            <span className="text-4xl font-black tracking-tight">Tap to Check In</span>
            <span className="text-indigo-200 text-lg">Verify your phone, then tell us why you're here</span>
          </button>
        )}

        {step !== "idle" && (
          <div className="w-full max-w-xl bg-white rounded-[2.5rem] p-10 shadow-2xl">
            {error && <p className="text-base text-red-600 bg-red-50 border border-red-200 rounded-2xl px-5 py-3 mb-5">{error}</p>}

            {step === "phone" && (
              <form onSubmit={requestOtp} className="space-y-6">
                <h1 className="text-3xl font-black text-slate-900">Your phone number</h1>
                <div className="text-lg">
                  <PhoneInput countryCode={countryCode} number={nationalNumber} onChange={(cc, n) => { setCountryCode(cc); setNationalNumber(n); }} required />
                </div>
                <div className="flex gap-3">
                  <KioskBackButton onClick={resetAll} />
                  <button type="submit" disabled={busy} className="flex-1 bg-indigo-600 text-white py-5 rounded-2xl text-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {busy && <Loader2 size={20} className="animate-spin" />} Send code
                  </button>
                </div>
              </form>
            )}

            {step === "code" && (
              <form onSubmit={verifyOtp} className="space-y-6">
                <h1 className="text-3xl font-black text-slate-900 flex items-center gap-2"><KeyRound size={26} /> Enter code</h1>
                <input
                  required autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-6 py-5 text-3xl font-mono tracking-[0.3em] text-center focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
                />
                <div className="flex gap-3">
                  <KioskBackButton onClick={() => setStep("phone")} />
                  <button type="submit" disabled={busy} className="flex-1 bg-indigo-600 text-white py-5 rounded-2xl text-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {busy && <Loader2 size={20} className="animate-spin" />} Verify
                  </button>
                </div>
              </form>
            )}

            {step === "photo" && (
              <div className="space-y-6 text-center">
                <h1 className="text-3xl font-black text-slate-900">Take your photo</h1>
                <p className="text-slate-500">This is shown to the gate guard to confirm it's you.</p>
                <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-square max-w-sm mx-auto">
                  {photo ? (
                    <img src={photo} alt="Captured" className="w-full h-full object-cover" />
                  ) : (
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex gap-3">
                  <KioskBackButton onClick={() => { setPhoto(null); setStep("code"); }} />
                  {photo ? (
                    <>
                      <button type="button" onClick={() => setPhoto(null)} className="flex-1 bg-slate-100 text-slate-600 py-5 rounded-2xl text-xl font-bold hover:bg-slate-200 transition-all">
                        Retake
                      </button>
                      <button type="button" onClick={() => setStep("form")} className="flex-1 bg-indigo-600 text-white py-5 rounded-2xl text-xl font-bold hover:bg-indigo-700 transition-all">
                        Use photo
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={capturePhoto} className="flex-1 bg-indigo-600 text-white py-5 rounded-2xl text-xl font-bold hover:bg-indigo-700 transition-all">
                      Capture
                    </button>
                  )}
                </div>
              </div>
            )}

            {step === "form" && (
              <form onSubmit={submit} className="space-y-5">
                <div className="flex items-center gap-2 text-teal-700 bg-teal-50 border border-teal-200 rounded-2xl px-5 py-3 text-sm font-bold">
                  <CheckCircle2 size={18} /> Phone verified
                </div>
                <input type="text" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="hidden" tabIndex={-1} autoComplete="off" />

                <KioskField label="Truck / trailer plate" value={form.truck_plate} onChange={(v) => setForm({ ...form, truck_plate: v.toUpperCase() })} required />
                <KioskField label="Carrier / company" value={form.carrier_name} onChange={(v) => setForm({ ...form, carrier_name: v })} required />
                <KioskField label="Personal identity number" value={form.personal_id_number} onChange={(v) => setForm({ ...form, personal_id_number: v })} required />
                <KioskField label="Trailer number (optional)" value={form.trailer_number} onChange={(v) => setForm({ ...form, trailer_number: v })} />
                <KioskField label="PO number (optional)" value={form.po_number} onChange={(v) => setForm({ ...form, po_number: v })} />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-widest text-slate-400">Load type</label>
                    <select value={form.load_type} onChange={(e) => setForm({ ...form, load_type: e.target.value })} className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-4 text-lg">
                      {LOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-widest text-slate-400">Direction</label>
                    <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-4 py-4 text-lg">
                      {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                <div className="pt-2 space-y-3">
                  <label className="text-sm font-bold uppercase tracking-widest text-slate-400">Terms &amp; safety guidelines</label>
                  <div
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setTermsScrolled(true);
                    }}
                    className="h-52 overflow-y-auto bg-slate-50 border-2 border-slate-200 rounded-2xl p-5 text-base text-slate-600 leading-relaxed space-y-3"
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
                  {!termsScrolled && <p className="text-sm text-slate-400">Scroll to the bottom of the document to continue.</p>}
                  <label className={`flex items-start gap-3 text-sm ${termsScrolled ? "text-slate-600" : "text-slate-300"}`}>
                    <input
                      type="checkbox"
                      disabled={!termsScrolled}
                      checked={form.terms_accepted}
                      onChange={(e) => setForm({ ...form, terms_accepted: e.target.checked })}
                      className="mt-0.5 w-5 h-5"
                    />
                    <span>I have read and accept the terms and safety guidelines for entering this yard.</span>
                  </label>
                </div>

                <label className="flex items-start gap-3 text-sm text-slate-500">
                  <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5 w-5 h-5" />
                  <span>I consent to my name, phone number, identity number, and vehicle details being processed for gate access purposes.</span>
                </label>

                <div className="flex gap-3">
                  <KioskBackButton onClick={() => setStep("photo")} />
                  <button type="submit" disabled={busy || !form.terms_accepted || !form.consent} className="flex-1 bg-indigo-600 text-white py-5 rounded-2xl text-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {busy && <Loader2 size={20} className="animate-spin" />} Request entry
                  </button>
                </div>
              </form>
            )}

            {step === "result" && (
              <ResultView status={status} onDone={resetAll} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ResultView({ status, onDone }: { status: any; onDone: () => void }) {
  if (!status) {
    return (
      <div className="text-center py-8">
        <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={40} />
        <p className="text-lg text-slate-500">Submitting...</p>
      </div>
    );
  }

  const views: Record<string, { icon: any; color: string; title: string; body: string }> = {
    pending_approval: { icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200", title: "Waiting for approval", body: "An admin has been notified. This screen updates automatically." },
    approved_awaiting_spot: { icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200", title: "Approved — yard is full", body: "You're cleared to enter once a spot opens up. Please wait." },
    rejected: { icon: XCircle, color: "text-red-600 bg-red-50 border-red-200", title: "Entry denied", body: status.rejection_reason || "Contact the facility for details." },
  };
  const view = views[status.status] || {
    icon: CheckCircle2, color: "text-teal-600 bg-teal-50 border-teal-200", title: "Approved",
    body: status.spotName ? `Proceed to spot ${status.spotName}.` : "You're cleared to enter.",
  };
  const Icon = view.icon;
  const isFinal = status.status !== "pending_approval" && status.status !== "approved_awaiting_spot";

  return (
    <div className="text-center py-4">
      <div className={`w-24 h-24 rounded-3xl border-2 flex items-center justify-center mx-auto mb-6 ${view.color}`}>
        <Icon size={44} />
      </div>
      <h1 className="text-3xl font-black text-slate-900 mb-2">{view.title}</h1>
      <p className="text-slate-500 text-lg mb-6">{view.body}</p>
      <p className="text-sm text-slate-400 font-mono mb-8">{status.plate} · {status.carrier} · WK-{status.id}</p>
      {isFinal && (
        <button onClick={onDone} className="w-full bg-slate-900 text-white py-4 rounded-2xl text-lg font-bold hover:bg-slate-800 transition-all">
          Done
        </button>
      )}
    </div>
  );
}

function KioskField({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-bold uppercase tracking-widest text-slate-400">{label}</label>
      <input required={required} value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl px-5 py-4 text-lg font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/20" />
    </div>
  );
}

function KioskBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="px-6 py-5 rounded-2xl bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">
      <ArrowLeft size={22} />
    </button>
  );
}
