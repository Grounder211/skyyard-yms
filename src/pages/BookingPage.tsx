import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Warehouse, CalendarDays, Loader2, CheckCircle2, AlertCircle, DoorOpen, Sparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const LOAD_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export default function BookingPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [carrier, setCarrier] = useState<any>(null);
  const [invalid, setInvalid] = useState(false);

  const [date, setDate] = useState(tomorrowISO());
  const [slots, setSlots] = useState<any[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState<any>(null);
  const [selectedDock, setSelectedDock] = useState<number | null>(null);
  const [recommended, setRecommended] = useState<any[]>([]);

  const [form, setForm] = useState({ plate: "", driver_name: "", driver_phone: "", load_type: "standard", temperature_requirement: "", load_weight_kg: "", special_instructions: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/book/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => setCarrier(data.carrier))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!carrier) return;
    setSlotsLoading(true);
    setSelectedTime(null);
    setSelectedDock(null);
    const weightParam = form.load_weight_kg ? `&load_weight_kg=${form.load_weight_kg}` : "";
    fetch(`/api/slots?date=${date}&load_type=${form.load_type}${weightParam}`)
      .then((r) => r.json())
      .then((data) => setSlots(Array.isArray(data) ? data : []))
      .finally(() => setSlotsLoading(false));
    fetch(`/api/slots/recommend?date=${date}&equipment_type=${form.load_type}&carrier_id=${carrier?.id || ""}${weightParam}`)
      .then((r) => r.json())
      .then((data) => setRecommended(Array.isArray(data) ? data : []))
      .catch(() => setRecommended([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrier, date, form.load_type, form.load_weight_kg]);

  const bestDockForTime = (time: string) => recommended.filter((r) => r.start_time === time).sort((a, b) => b.score - a.score)[0];
  const topPick = recommended.find((r) => r.recommended);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTime || !selectedDock) {
      setError("Pick an arrival time first.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/book/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, start_time: selectedTime.dateTime, dock_id: selectedDock }),
      });
      const data = await res.json();
      if (res.ok) setConfirmed(data.appointment);
      else setError(data.error || "Booking failed");
    } catch {
      setError("Network error while booking");
    }
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
        <div className="text-center max-w-sm">
          <AlertCircle className="mx-auto text-red-500 mb-4" size={36} />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Invalid or expired link</h1>
          <p className="text-sm text-slate-500">Ask your terminal contact for a fresh booking link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="p-6 max-w-2xl mx-auto flex items-center gap-2">
        <Warehouse className="text-indigo-600 w-7 h-7" />
        <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Booking</span>
      </header>

      <main className="max-w-2xl mx-auto p-6 pb-20">
        {confirmed ? (
          <div className="bg-white border border-slate-100 rounded-3xl p-8 text-center shadow-xl shadow-slate-100">
            <CheckCircle2 className="mx-auto text-teal-600 mb-4" size={40} />
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Appointment confirmed</h1>
            <p className="text-slate-500 mb-6">
              {confirmed.plate} — {new Date(confirmed.start_time).toLocaleString()}
            </p>
            <div className="flex justify-center mb-6">
              <QRCodeSVG value={`APT-${confirmed.id}`} size={140} level="M" />
            </div>
            <p className="text-sm text-slate-500">Show this QR code at the gate for a fast check-in. Reference: <span className="font-mono font-bold">APT-{confirmed.id}</span></p>
          </div>
        ) : (
          <>
            <div className="bg-white border border-slate-100 rounded-3xl p-6 mb-6">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Booking for</p>
              <p className="text-lg font-bold text-slate-900">{carrier?.name}</p>
            </div>

            <form onSubmit={submit} className="bg-white border border-slate-100 rounded-3xl p-8 space-y-6 shadow-xl shadow-slate-100">
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">{error}</p>}

              <div className="grid grid-cols-2 gap-4">
                <TextField label="Truck plate" required value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} />
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Load type</label>
                  <select value={form.load_type} onChange={(e) => setForm({ ...form, load_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                    {LOAD_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <TextField label="Driver name" value={form.driver_name} onChange={(v) => setForm({ ...form, driver_name: v })} />
                <TextField label="Driver phone" value={form.driver_phone} onChange={(v) => setForm({ ...form, driver_phone: v })} placeholder="+46 70 123 4567" />
                <TextField label="Load weight (kg, optional)" value={form.load_weight_kg} onChange={(v) => setForm({ ...form, load_weight_kg: v.replace(/[^0-9]/g, "") })} placeholder="e.g. 24000" />
                {form.load_type === "reefer" && (
                  <TextField label="Required temperature (°C)" value={form.temperature_requirement} onChange={(v) => setForm({ ...form, temperature_requirement: v })} placeholder="-18" />
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Special instructions (optional)</label>
                <textarea
                  value={form.special_instructions}
                  onChange={(e) => setForm({ ...form, special_instructions: e.target.value.slice(0, 500) })}
                  placeholder="e.g. fragile cargo, forklift required, driver needs translator"
                  rows={2}
                  maxLength={500}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <CalendarDays size={12} /> Arrival date
                </label>
                <input type="date" min={tomorrowISO()} value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <DoorOpen size={12} /> Available times
                </label>
                {slotsLoading ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="animate-spin text-indigo-600" size={20} />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {slots.map((s) => (
                      <button
                        type="button"
                        key={s.time}
                        disabled={s.availableCount === 0}
                        onClick={() => {
                          setSelectedTime(s);
                          const best = bestDockForTime(s.time);
                          setSelectedDock(best?.dock_id || s.docks[0]?.id || null);
                        }}
                        className={`relative px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                          selectedTime?.time === s.time
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : s.availableCount === 0
                            ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                            : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                        }`}
                      >
                        {topPick?.start_time === s.time && (
                          <Sparkles size={11} className="absolute -top-1.5 -right-1.5 text-amber-500 bg-white rounded-full p-0.5" strokeWidth={2.5} />
                        )}
                        {s.time}
                      </button>
                    ))}
                  </div>
                )}
                {topPick && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Sparkles size={11} className="text-amber-500" /> {topPick.start_time} at {topPick.dock_name} is the best match — {topPick.reason}.</p>}
                {slots[0]?.estimatedMinutes && <p className="text-xs text-slate-400">Estimated dock time for a {form.load_type} load: ~{slots[0].estimatedMinutes} min.</p>}
              </div>

              <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 size={16} className="animate-spin" />} Confirm booking
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function TextField({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</label>
      <input required={required} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
    </div>
  );
}
