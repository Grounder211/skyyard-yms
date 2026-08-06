import React, { useEffect, useState } from "react";
import { Globe2, Coins, Clock, Bell, Warehouse, FileLock2, CheckCircle2, Loader2, DoorOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { useToast } from "../contexts/ToastContext";

const CURRENCIES = ["SEK", "EUR", "USD", "NOK", "DKK"];
const LOCALES = [
  { value: "sv-SE", label: "Swedish (Sweden)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-US", label: "English (US)" },
];

export default function Settings() {
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const [facility, setFacility] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);

  const load = () => {
    fetch("/api/settings/general")
      .then((r) => r.json())
      .then((data) => {
        setFacility(data.facility);
        setSettings(data.settings);
      })
      .finally(() => setLoading(false));
    fetch("/api/admin/data-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRequests(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(load, []);

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/settings/general", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: settings.currency,
        locale: settings.locale,
        timezone: settings.timezone,
        detention_rate_per_hour: settings.detention_rate_per_hour,
        detention_threshold_hours: settings.detention_threshold_hours,
      }),
    });
    setSaving(false);
    if (res.ok) toast("Settings saved", "success");
    else toast("Failed to save settings", "error");
  };

  const updateRequest = async (id: string, status: string) => {
    await fetch(`/api/admin/data-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  if (loading || !settings) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
        <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-20">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-slate-500 font-medium">Facility configuration, localization, and data privacy.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 space-y-6">
        <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
          <Warehouse size={18} className="text-indigo-600" /> Facility
        </h3>
        <p className="text-sm text-slate-500">{facility?.name}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Coins size={12} /> Currency
            </label>
            <select value={settings.currency || "SEK"} onChange={(e) => setSettings({ ...settings, currency: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Globe2 size={12} /> Locale
            </label>
            <select value={settings.locale || "sv-SE"} onChange={(e) => setSettings({ ...settings, locale: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Clock size={12} /> Detention threshold (hours)
            </label>
            <input type="number" value={settings.detention_threshold_hours ?? 24} onChange={(e) => setSettings({ ...settings, detention_threshold_hours: Number(e.target.value) })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Detention rate / hour</label>
            <input type="number" value={settings.detention_rate_per_hour ?? 75} onChange={(e) => setSettings({ ...settings, detention_rate_per_hour: Number(e.target.value) })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">Interface language</p>
            <p className="text-xs text-slate-500">Applies to navigation and staff-facing screens.</p>
          </div>
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setLang("en")} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${lang === "en" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>EN</button>
            <button onClick={() => setLang("sv")} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${lang === "sv" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>SV</button>
          </div>
        </div>

        <button onClick={save} disabled={saving} className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin" />} Save settings
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Link to="/settings/notifications" className="bg-white border border-slate-200 rounded-3xl p-6 flex items-center gap-4 hover:border-indigo-300 hover:shadow-md transition-all">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Bell size={18} />
          </div>
          <div>
            <p className="font-bold text-slate-900">Notifications</p>
            <p className="text-xs text-slate-500">SMS, email, and in-app channels</p>
          </div>
        </Link>
        <Link to="/settings/dock-rules" className="bg-white border border-slate-200 rounded-3xl p-6 flex items-center gap-4 hover:border-indigo-300 hover:shadow-md transition-all">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <DoorOpen size={18} />
          </div>
          <div>
            <p className="font-bold text-slate-900">Dock equipment rules</p>
            <p className="text-xs text-slate-500">Which loads each door accepts</p>
          </div>
        </Link>
        <a href="/privacy" target="_blank" rel="noreferrer" className="bg-white border border-slate-200 rounded-3xl p-6 flex items-center gap-4 hover:border-indigo-300 hover:shadow-md transition-all">
          <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <FileLock2 size={18} />
          </div>
          <div>
            <p className="font-bold text-slate-900">Public privacy request page</p>
            <p className="text-xs text-slate-500">GDPR self-service link to share</p>
          </div>
        </a>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8">
        <h3 className="font-bold text-slate-900 text-lg mb-1 flex items-center gap-2">
          <FileLock2 size={18} className="text-teal-600" /> GDPR data requests
        </h3>
        <p className="text-sm text-slate-500 mb-6">Access, deletion, and correction requests — Swedish/EU data protection (IMY) requires a response within 72 hours.</p>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No pending requests.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-bold text-slate-900">{r.request_type} — {r.requester_email || r.requester_phone}</p>
                  <p className="text-xs text-slate-500">Deadline {new Date(r.deadline_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${r.status === "completed" ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-700"}`}>{r.status}</span>
                  {r.status !== "completed" && (
                    <button onClick={() => updateRequest(r.id, "completed")} className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Mark done
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
