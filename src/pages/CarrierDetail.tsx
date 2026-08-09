import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Truck, TriangleAlert, Clock, DollarSign, Users, ShieldCheck } from "lucide-react";

export default function CarrierDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/carriers/${id}/scorecard`).then((r) => r.ok ? r.json() : null).then(setData).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-slate-400 text-center py-20">Loading...</p>;
  if (!data) return <p className="text-sm text-slate-400 text-center py-20">Carrier not found.</p>;

  const { carrier, appointments, detentions, vehicleCount, driverCount, totalAppts, noShows, avgDwellMinutes, detentionTotal } = data;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-20">
      <Link to="/network" className="text-sm font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1.5">
        <ArrowLeft size={14} /> Back
      </Link>

      <div className="bg-white border border-slate-200 rounded-3xl p-8 flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Truck className="text-indigo-600" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{carrier.name}</h1>
            <p className="text-sm text-slate-500">{carrier.email || "No email on file"} · {carrier.contact_phone || "No phone on file"}</p>
          </div>
        </div>
        {carrier.flagged && (
          <span className="shrink-0 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1.5">
            <TriangleAlert size={12} /> Flagged
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <Clock className="text-indigo-600 mb-2" size={18} />
          <p className="text-2xl font-bold text-slate-900">{avgDwellMinutes != null ? `${avgDwellMinutes}m` : "—"}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Avg dwell</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <TriangleAlert className={noShows > 0 ? "text-red-600 mb-2" : "text-slate-300 mb-2"} size={18} />
          <p className="text-2xl font-bold text-slate-900">{noShows} / {totalAppts}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">No-shows / visits</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <DollarSign className={detentionTotal > 0 ? "text-red-600 mb-2" : "text-slate-300 mb-2"} size={18} />
          <p className="text-2xl font-bold text-slate-900">{detentionTotal.toFixed(0)}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Active detention owed</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <Users className="text-slate-400 mb-2" size={18} />
          <p className="text-2xl font-bold text-slate-900">{driverCount}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Registered drivers</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <ShieldCheck className="text-slate-400 mb-2" size={18} />
          <p className="text-2xl font-bold text-slate-900">{vehicleCount}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Registered vehicles</p>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Recent appointments</h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {appointments.length === 0 ? (
            <p className="text-sm text-slate-400 p-8 text-center">No appointments on file.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {appointments.map((a: any) => (
                <div key={a.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{a.plate}</p>
                    <p className="text-xs text-slate-500">{new Date(a.start_time).toLocaleString()}</p>
                  </div>
                  <span className={`text-xs font-bold ${a.no_show_flag ? "text-red-600" : "text-indigo-600"}`}>{a.no_show_flag ? "No-show" : a.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {detentions.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Detention history</h2>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-50">
            {detentions.map((d: any) => (
              <div key={d.id} className="px-6 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">{new Date(d.created_at).toLocaleDateString()}</p>
                <span className={`text-xs font-bold ${d.status === "ACTIVE" ? "text-red-600" : "text-slate-500"}`}>{Number(d.amount_owed).toFixed(0)} · {d.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
