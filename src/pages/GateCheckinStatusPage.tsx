import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Warehouse, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

// Public, token-gated (status_token is the secret — no staff auth needed).
// Driver lands here right after submitting and watches the admin decision
// arrive without walking back to an office that, at an unmanned gate,
// doesn't exist.
export default function GateCheckinStatusPage() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch(`/api/public/walkin/status/${token}`)
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {
          if (!cancelled) setNotFound(true);
        });
    };
    poll();
    const interval = setInterval(() => {
      if (data?.status === "pending_approval" || !data) poll();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, data?.status]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <p className="text-slate-500 text-sm">Invalid or expired link.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={24} />
      </div>
    );
  }

  const statusView: Record<string, { icon: any; color: string; title: string; body: string }> = {
    pending_approval: { icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200", title: "Waiting for approval", body: "An admin has been notified. This page updates automatically." },
    approved_awaiting_spot: { icon: Clock, color: "text-amber-600 bg-amber-50 border-amber-200", title: "Approved — yard is full", body: "You're cleared to enter once a spot opens up. Please wait." },
    rejected: { icon: XCircle, color: "text-red-600 bg-red-50 border-red-200", title: "Entry denied", body: data.rejection_reason || "Contact the facility for details." },
  };

  const view = statusView[data.status] || {
    icon: CheckCircle2, color: "text-teal-600 bg-teal-50 border-teal-200", title: "Approved",
    body: data.spotName ? `Proceed to spot ${data.spotName}.` : "You're cleared to enter.",
  };
  const Icon = view.icon;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="p-6 flex items-center gap-2 max-w-lg mx-auto w-full">
        <Warehouse className="text-indigo-600 w-7 h-7" />
        <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Gate</span>
      </header>
      <main className="flex-1 flex items-start justify-center px-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-sm mt-4 text-center">
          <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto mb-5 ${view.color}`}>
            <Icon size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-1">{view.title}</h1>
          <p className="text-slate-500 text-sm mb-4">{view.body}</p>
          <p className="text-xs text-slate-400 font-mono">{data.plate} · {data.carrier} · WK-{data.id}</p>
        </div>
      </main>
    </div>
  );
}
