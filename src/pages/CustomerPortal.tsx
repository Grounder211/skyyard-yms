import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Warehouse, AlertCircle, CheckCircle2, Clock, Truck } from "lucide-react";

// Read-only, token-in-URL — same trust model as carrier booking links.
// No POD anywhere in the schema yet, so this shows real status/timing
// only, not a proof-of-delivery field that doesn't exist.
export default function CustomerPortal() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState("");
  const [shipments, setShipments] = useState<any[]>([]);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    fetch(`/api/customer/${token}/shipments`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setCustomerName(d.customer_name); setShipments(d.shipments || []); })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

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
          <h1 className="text-xl font-bold text-slate-900 mb-2">Invalid link</h1>
          <p className="text-sm text-slate-500">Ask your terminal contact for a fresh portal link.</p>
        </div>
      </div>
    );
  }

  const statusInfo: Record<string, { label: string; color: string; icon: any }> = {
    SCHEDULED: { label: "Scheduled", color: "bg-slate-100 text-slate-600", icon: Clock },
    no_show: { label: "No-show", color: "bg-red-100 text-red-700", icon: AlertCircle },
    COMPLETED: { label: "Completed", color: "bg-teal-100 text-teal-700", icon: CheckCircle2 },
    CANCELLED: { label: "Cancelled", color: "bg-slate-100 text-slate-500", icon: AlertCircle },
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="p-6 max-w-2xl mx-auto flex items-center gap-2">
        <Warehouse className="text-indigo-600 w-7 h-7" />
        <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Shipment Status</span>
      </header>

      <main className="max-w-2xl mx-auto p-6 pb-20">
        <div className="bg-white border border-slate-100 rounded-3xl p-6 mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Viewing shipments for</p>
          <p className="text-lg font-bold text-slate-900">{customerName}</p>
        </div>

        {shipments.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">No shipments on file yet.</p>
        ) : (
          <div className="space-y-3">
            {shipments.map((s) => {
              const info = statusInfo[s.status] || (s.checked_in_at
                ? { label: "In progress", color: "bg-indigo-100 text-indigo-700", icon: Truck }
                : { label: s.status, color: "bg-slate-100 text-slate-600", icon: Clock });
              const Icon = info.icon;
              return (
                <div key={s.id} className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">{s.plate}</p>
                    <p className="text-sm text-slate-500">{s.carrier} · {new Date(s.start_time).toLocaleString()}</p>
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full flex items-center gap-1.5 ${info.color}`}>
                    <Icon size={12} /> {info.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
