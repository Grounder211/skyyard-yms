import React, { useState } from "react";
import { Warehouse, Loader2, AlertCircle, Globe2, ShieldCheck, Truck, Building2, KeyRound } from "lucide-react";
import { motion } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import { useI18n } from "../lib/i18n";
import { Link } from "react-router-dom";

const DEMO_ACCOUNTS = [
  { email: "admin@skyyard.se", role: "Admin" },
  { email: "guard@skyyard.se", role: "Guard" },
  { email: "superadmin@skyyard.se", role: "Superadmin" },
];

export default function Login() {
  const { login, verifyTotp } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.requiresTotp) {
      setNeedsTotp(true);
      return;
    }
    if (!result.success) setError(result.error || "Login failed");
  };

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await verifyTotp(totpCode);
    setLoading(false);
    if (!result.success) setError(result.error || "Invalid code");
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="p-8 flex justify-between items-center max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <Warehouse className="text-indigo-600 w-8 h-8" />
          <span className="font-bold text-2xl tracking-tight text-slate-900">SkyYard</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLang(lang === "en" ? "sv" : "en")}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            <Globe2 size={16} />
            {lang === "en" ? "Svenska" : "English"}
          </button>
          <Link to="/book/demo" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors hidden sm:block">
            Carrier booking
          </Link>
          <Link to="/driver" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors hidden sm:block">
            Driver check-in
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">{t("login.title")}</h1>
            <p className="text-slate-500">{t("login.subtitle")}</p>
          </div>

          {needsTotp ? (
            <form onSubmit={submitTotp} className="bg-white border border-slate-100 rounded-3xl p-8 shadow-xl shadow-slate-100 space-y-5">
              {error && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-100 text-red-700 text-sm font-medium px-4 py-3 rounded-xl">
                  <AlertCircle size={16} className="shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-medium px-4 py-3 rounded-xl">
                <KeyRound size={16} className="shrink-0" />
                Enter the 6-digit code from your authenticator app
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  autoFocus
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-mono tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                Verify
              </button>
              <button
                type="button"
                onClick={() => { setNeedsTotp(false); setTotpCode(""); setError(""); }}
                className="w-full text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors"
              >
                Back to login
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={submit} className="bg-white border border-slate-100 rounded-3xl p-8 shadow-xl shadow-slate-100 space-y-5">
                {error && (
                  <div className="flex items-center gap-3 bg-red-50 border border-red-100 text-red-700 text-sm font-medium px-4 py-3 rounded-xl">
                    <AlertCircle size={16} className="shrink-0" />
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">{t("login.email")}</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@skyyard.se"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">{t("login.password")}</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {t("login.submit")}
                </button>
              </form>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">{t("login.demo")}</p>
                <div className="space-y-1.5">
                  {DEMO_ACCOUNTS.map((a) => (
                    <button
                      type="button"
                      key={a.email}
                      onClick={() => {
                        setEmail(a.email);
                        setPassword("Skyyard#2026");
                      }}
                      className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg hover:bg-white transition-colors"
                    >
                      <span className="text-xs font-mono text-slate-600">{a.email}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">{a.role}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-3">Password for all demo accounts: <span className="font-mono">Skyyard#2026</span></p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Link to="/driver" className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all">
                  <Truck className="text-slate-400" size={18} />
                  <span className="text-sm font-semibold text-slate-700">Driver portal</span>
                </Link>
                <Link to="/carrier" className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all">
                  <Building2 className="text-slate-400" size={18} />
                  <span className="text-sm font-semibold text-slate-700">Carrier portal</span>
                </Link>
              </div>
            </>
          )}
        </motion.div>
      </main>

      <footer className="p-8 border-t border-slate-100 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
        <ShieldCheck size={14} />
        &copy; {new Date().getFullYear()} SkyYard Operations. GDPR-compliant terminal logistics.
      </footer>
    </div>
  );
}
