import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Warehouse, AlertCircle, CheckCircle2, Clock, Truck, PackageSearch } from "lucide-react";

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
      <div className="min-h-screen bg-slate-50">
        <header className="p-6 max-w-2xl mx-auto flex items-center gap-2">
          <Warehouse className="text-indigo-600 w-7 h-7" />
          <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Shipment Status</span>
        </header>
        <main className="max-w-2xl mx-auto p-6 pb-20 space-y-3">
          <div className="h-24 bg-slate-100 rounded-3xl animate-pulse" />
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
        </main>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="p-6 max-w-2xl mx-auto flex items-center gap-2">
          <Warehouse className="text-indigo-600 w-7 h-7" />
          <span className="font-bold text-xl tracking-tight text-slate-900">SkyYard Shipment Status</span>
        </header>
        <div className="flex items-center justify-center px-8 py-16">
          <div className="text-center max-w-sm">
            <AlertCircle className="mx-auto text-red-500 mb-4" size={36} />
            <h1 className="text-xl font-bold text-slate-900 mb-2">Invalid link</h1>
            <p className="text-sm text-slate-500">Ask your terminal contact for a fresh portal link.</p>
          </div>
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
          <div className="text-center py-16">
            <PackageSearch className="mx-auto text-slate-300 mb-3" size={32} />
            <p className="text-sm text-slate-400">No shipments on file yet — they'll appear here once scheduled.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shipments.map((s) => {
              const info = statusInfo[s.status] || (s.checked_in_at
                ? { label: "In progress", color: "bg-indigo-100 text-indigo-700", icon: Truck }
                : { label: s.status, color: "bg-slate-100 text-slate-600", icon: Clock });
              const Icon = info.icon;
              const dwellMinutes = s.checked_in_at && s.checked_out_at
                ? Math.round((new Date(s.checked_out_at).getTime() - new Date(s.checked_in_at).getTime()) / 60000)
                : null;
              return (
                <div key={s.id} className="bg-white border border-slate-100 rounded-2xl p-5 flex items-center justify-between gap-4 transition-shadow hover:shadow-md hover:shadow-slate-100">
                  <div>
                    <p className="font-bold text-slate-900">{s.plate}</p>
                    <p className="text-sm text-slate-500">{s.carrier} · {new Date(s.start_time).toLocaleString()}</p>
                    {dwellMinutes != null && (
                      <p className="text-xs text-slate-400 mt-0.5">On site {Math.floor(dwellMinutes / 60)}h {dwellMinutes % 60}m</p>
                    )}
                    {s.trailer_status_detail && dwellMinutes == null && (
                      <p className="text-xs text-slate-400 mt-0.5">{s.trailer_status_detail}</p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full flex items-center gap-1.5 ${info.color}`}>
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
