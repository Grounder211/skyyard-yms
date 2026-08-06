import React, { useState } from "react";
import { Warehouse, FileLock2, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

const TYPES = [
  { value: "access", label: "Access my data" },
  { value: "deletion", label: "Delete my data" },
  { value: "correction", label: "Correct my data" },
];

export default function PrivacyRequest() {
  const [type, setType] = useState("access");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/privacy/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_type: type, phone_or_email: contact }),
      });
      if (res.ok) setDone(true);
      else setError("Something went wrong. Please try again.");
    } catch {
      setError("Network error");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="p-6 max-w-xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <Warehouse className="text-indigo-600 w-7 h-7" />
          <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard</span>
        </Link>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full p-6 flex items-center">
        <div className="w-full bg-white border border-slate-100 rounded-3xl p-8 shadow-xl shadow-slate-100">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
              <FileLock2 size={24} />
            </div>
          </div>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="mx-auto text-teal-600 mb-4" size={36} />
              <h1 className="text-xl font-bold text-slate-900 mb-2">Request received</h1>
              <p className="text-sm text-slate-500">We'll process it within 72 hours in line with GDPR / Swedish data protection rules (Datainspektionen / IMY).</p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-center text-slate-900 mb-1">Data privacy request</h1>
              <p className="text-sm text-slate-500 text-center mb-6">
                Request access to, deletion of, or correction of the personal data SkyYard holds about you, in line with GDPR.
              </p>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 mb-4">{error}</p>}

              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Request type</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Phone or email on file</label>
                  <input required value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com or +46 70 123 4567" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
                </div>
                <button type="submit" disabled={busy} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy && <Loader2 size={16} className="animate-spin" />} Submit request
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
