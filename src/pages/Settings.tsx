import React, { useEffect, useState } from "react";
import { Globe2, Coins, Clock, Bell, Warehouse, FileLock2, CheckCircle2, Loader2, DoorOpen, ShieldCheck, KeyRound, Copy, Code2, Ban, AlertCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisableForm, setShowDisableForm] = useState(false);

  const loadTotpStatus = () => {
    fetch("/api/auth/2fa/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setTotpEnabled(!!d.enabled))
      .catch(() => {});
  };

  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyTier, setNewKeyTier] = useState("standard");
  const [keyBusy, setKeyBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const loadApiKeys = () => {
    fetch("/api/admin/api-keys")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setApiKeys(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const createApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setKeyBusy(true);
    const res = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName, tier: newKeyTier }),
    });
    setKeyBusy(false);
    if (res.ok) {
      const data = await res.json();
      setRevealedKey(data.key);
      setNewKeyName("");
      loadApiKeys();
    } else {
      toast("Failed to create API key", "error");
    }
  };

  const revokeApiKey = async (id: string) => {
    if (!confirm("Revoke this API key? Anything using it will stop working immediately.")) return;
    const res = await fetch(`/api/admin/api-keys/${id}/revoke`, { method: "POST" });
    if (res.ok) {
      toast("API key revoked", "success");
      loadApiKeys();
    }
  };

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
    loadTotpStatus();
    loadApiKeys();
  };

  useEffect(load, []);

  const startTotpSetup = async () => {
    setTotpBusy(true);
    const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
    setTotpBusy(false);
    if (res.ok) setTotpSetup(await res.json());
    else toast("Failed to start 2FA setup", "error");
  };

  const confirmTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpBusy(true);
    const res = await fetch("/api/auth/2fa/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: totpCode }),
    });
    setTotpBusy(false);
    if (res.ok) {
      toast("Two-factor authentication enabled", "success");
      setTotpSetup(null);
      setTotpCode("");
      setTotpEnabled(true);
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Invalid code", "error");
    }
  };

  const disableTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpBusy(true);
    const res = await fetch("/api/auth/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: disablePassword }),
    });
    setTotpBusy(false);
    if (res.ok) {
      toast("Two-factor authentication disabled", "success");
      setTotpEnabled(false);
      setShowDisableForm(false);
      setDisablePassword("");
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.error || "Incorrect password", "error");
    }
  };

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

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 space-y-5">
        <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
          <ShieldCheck size={18} className="text-indigo-600" /> Two-factor authentication
        </h3>

        {totpEnabled && !showDisableForm && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-teal-700 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 text-sm font-bold">
              <CheckCircle2 size={16} /> 2FA is active on your account
            </div>
            <button onClick={() => setShowDisableForm(true)} className="text-sm font-bold text-red-600 hover:text-red-700">Disable</button>
          </div>
        )}

        {totpEnabled && showDisableForm && (
          <form onSubmit={disableTotp} className="space-y-3 max-w-sm">
            <p className="text-sm text-slate-500">Enter your password to disable two-factor authentication.</p>
            <input type="password" required value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder="Current password" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            <div className="flex gap-2">
              <button type="submit" disabled={totpBusy} className="bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-700 transition-all disabled:opacity-50 flex items-center gap-1.5">
                {totpBusy && <Loader2 size={12} className="animate-spin" />} Confirm disable
              </button>
              <button type="button" onClick={() => { setShowDisableForm(false); setDisablePassword(""); }} className="text-xs font-bold text-slate-500 hover:text-slate-800 px-4 py-2">Cancel</button>
            </div>
          </form>
        )}

        {!totpEnabled && !totpSetup && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-slate-500 max-w-md">Require a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password) in addition to your password.</p>
            <button onClick={startTotpSetup} disabled={totpBusy} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2 shrink-0">
              {totpBusy && <Loader2 size={14} className="animate-spin" />} Enable 2FA
            </button>
          </div>
        )}

        {!totpEnabled && totpSetup && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 w-fit">
              <QRCodeSVG value={totpSetup.otpauth_url} size={160} level="M" />
            </div>
            <form onSubmit={confirmTotpSetup} className="space-y-3">
              <p className="text-sm text-slate-500">Scan the QR code, or enter this key manually:</p>
              <button type="button" onClick={() => { navigator.clipboard?.writeText(totpSetup.secret); toast("Secret copied", "success"); }} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-600 hover:border-indigo-300 transition-all w-full text-left">
                <Copy size={12} className="shrink-0" /> {totpSetup.secret}
              </button>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><KeyRound size={12} /> Verification code</label>
                <input type="text" inputMode="numeric" required maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={totpBusy} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {totpBusy && <Loader2 size={12} className="animate-spin" />} Confirm & enable
                </button>
                <button type="button" onClick={() => { setTotpSetup(null); setTotpCode(""); }} className="text-xs font-bold text-slate-500 hover:text-slate-800 px-4 py-2">Cancel</button>
              </div>
            </form>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 space-y-5">
        <div>
          <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
            <Code2 size={18} className="text-indigo-600" /> API keys
          </h3>
          <p className="text-sm text-slate-500 mt-1">For partner/EDI integrations against the /api/v1 external API. Each key is shown once at creation — store it somewhere safe.</p>
        </div>

        {revealedKey && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
              <AlertCircle size={13} /> Copy this now — it won't be shown again
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs font-mono break-all">{revealedKey}</code>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(revealedKey); toast("Key copied", "success"); }}
                className="shrink-0 bg-amber-600 text-white p-2 rounded-lg hover:bg-amber-700 transition-all"
              >
                <Copy size={14} />
              </button>
            </div>
            <button type="button" onClick={() => setRevealedKey(null)} className="text-xs font-bold text-amber-700 hover:text-amber-900">
              I've saved it, dismiss
            </button>
          </div>
        )}

        <form onSubmit={createApiKey} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 flex-1 min-w-[180px]">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Key name</label>
            <input required value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g. Nordic Freight EDI" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Tier</label>
            <select value={newKeyTier} onChange={(e) => setNewKeyTier(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm">
              <option value="standard">Standard (100 req/min)</option>
              <option value="enterprise">Enterprise (500 req/min)</option>
            </select>
          </div>
          <button type="submit" disabled={keyBusy} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2">
            {keyBusy && <Loader2 size={14} className="animate-spin" />} Generate key
          </button>
        </form>

        {apiKeys.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-sm truncate">{k.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{k.key_prefix}••••••••••••••••••••</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{k.tier}</span>
                  {k.revoked_at ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700">Revoked</span>
                  ) : (
                    <button onClick={() => revokeApiKey(k.id)} className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1">
                      <Ban size={12} /> Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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
