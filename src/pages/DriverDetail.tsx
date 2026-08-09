import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, User, Star, ShieldAlert, CalendarClock, BadgeCheck } from "lucide-react";

export default function DriverDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/drivers/${id}`).then((r) => r.ok ? r.json() : null).then(setData).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-slate-400 text-center py-20">Loading...</p>;
  if (!data) return <p className="text-sm text-slate-400 text-center py-20">Driver not found.</p>;

  const { driver, avgRating, ratingCount, appointments, safetyIncidents } = data;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-20">
      <Link to="/gate" className="text-sm font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1.5">
        <ArrowLeft size={14} /> Back
      </Link>

      <div className="bg-white border border-slate-200 rounded-3xl p-8 flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <User className="text-indigo-600" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{driver.name || "Unnamed driver"}</h1>
            <p className="text-sm text-slate-500">{driver.phone} · {driver.carrier_name || "No carrier on file"}</p>
            {driver.default_plate && <p className="text-xs text-slate-400 mt-1">Default plate: {driver.default_plate}</p>}
          </div>
        </div>
        {driver.badge_issued_at && (
          <span className="shrink-0 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full bg-teal-100 text-teal-700 flex items-center gap-1.5">
            <BadgeCheck size={12} /> Badge issued
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <Star className="text-amber-500 mb-2" size={18} />
          <p className="text-2xl font-bold text-slate-900">{avgRating != null ? `${avgRating}/5` : "—"}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">{ratingCount} rating(s)</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <CalendarClock className="text-indigo-600 mb-2" size={18} />
          <p className="text-2xl font-bold text-slate-900">{appointments.length}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Recent appointments</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <ShieldAlert className={safetyIncidents.length > 0 ? "text-red-600 mb-2" : "text-slate-300 mb-2"} size={18} />
          <p className="text-2xl font-bold text-slate-900">{safetyIncidents.length}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Safety incidents</p>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Appointment history</h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {appointments.length === 0 ? (
            <p className="text-sm text-slate-400 p-8 text-center">No appointments on file.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {appointments.map((a: any) => (
                <div key={a.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{a.plate}</p>
                    <p className="text-xs text-slate-500">{a.carrier} · {new Date(a.start_time).toLocaleString()}</p>
                  </div>
                  <span className={`text-xs font-bold ${a.no_show_flag ? "text-red-600" : "text-indigo-600"}`}>{a.no_show_flag ? "No-show" : a.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {safetyIncidents.length > 0 && (
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Safety history</h2>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-50">
            {safetyIncidents.map((s: any) => (
              <div key={s.id} className="px-6 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">{s.category?.replace(/_/g, " ")}</p>
                <span className="text-xs font-bold text-slate-500">{s.severity} · {s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
