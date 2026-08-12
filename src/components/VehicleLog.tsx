import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Truck } from "lucide-react";

const STATE_STYLES: Record<string, string> = {
  ARRIVED: "bg-teal-50 text-teal-700",
  DEPARTED: "bg-slate-100 text-slate-500",
  EXPECTED: "bg-amber-50 text-amber-700",
};

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Escaped per RFC4180 — a carrier called "Smith, Sons" would otherwise
// silently split into two columns in Excel.
const csvCell = (v: unknown) => {
  const s = v == null || v === "" ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function VehicleLog() {
  const today = toLocalInput(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const start = new Date(`${from}T00:00:00`).toISOString();
    const end = new Date(`${to}T23:59:59`).toISOString();
    try {
      const res = await fetch(`/api/admin/vehicle-log?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      const data = res.ok ? await res.json() : { rows: [] };
      setRows(data.rows || []);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const downloadCsv = () => {
    const header = ["Plate", "Carrier", "Driver", "Phone", "Load type", "Source", "State", "Scheduled", "Arrived", "Departed", "Spot"];
    const body = rows.map((r) => [
      r.plate, r.carrier, r.driverName, r.driverPhone, r.loadType, r.source, r.state,
      r.scheduledAt ? new Date(r.scheduledAt).toLocaleString() : "",
      r.arrivedAt ? new Date(r.arrivedAt).toLocaleString() : "",
      r.departedAt ? new Date(r.departedAt).toLocaleString() : "",
      r.spotName,
    ]);
    const csv = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `skyyard-vehicles-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = {
    arrived: rows.filter((r) => r.state === "ARRIVED").length,
    expected: rows.filter((r) => r.state === "EXPECTED").length,
    departed: rows.filter((r) => r.state === "DEPARTED").length,
  };

  return (
    <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-xl shadow-slate-200/50 p-8 mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
            <Truck size={18} className="text-indigo-600" /> Vehicle log
          </h3>
          <p className="text-slate-500 text-sm mt-1">
            Bookings and walk-ins together — {counts.arrived} arrived, {counts.expected} expected, {counts.departed} departed.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <button
            onClick={downloadCsv}
            disabled={rows.length === 0}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-40 flex items-center gap-2"
          >
            <Download size={14} /> Download report
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading...
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-10 text-center">No vehicles booked or checked in for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                {["Plate", "Carrier", "Driver", "Load type", "Source", "State", "Scheduled", "Arrived", "Departed", "Spot"].map((c) => (
                  <th key={c} className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 pb-2 pr-4 whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-4 font-bold text-slate-900 whitespace-nowrap">{r.plate || "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.carrier || "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.driverName || "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.loadType || "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.source}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATE_STYLES[r.state] || ""}`}>{r.state}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.scheduledAt ? new Date(r.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.arrivedAt ? new Date(r.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.departedAt ? new Date(r.departedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{r.spotName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
