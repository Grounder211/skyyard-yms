import React, { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Clock, Activity, Target, Cpu, BarChart3, ChevronRight, Calendar, AlertCircle } from "lucide-react";
import { Line, Bar } from "react-chartjs-2";
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title, 
  Tooltip, 
  Legend, 
  Filler 
} from "chart.js";

ChartJS.register(
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title, 
  Tooltip, 
  Legend, 
  Filler
);

export default function ExecutiveDashboard() {
  const [range, setRange] = useState({ 
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
    end: new Date().toISOString().split('T')[0] 
  });
  const [metrics, setMetrics] = useState<any>(null);
  const [carrierStats, setCarrierStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [heatmap, setHeatmap] = useState<number[][] | null>(null);
  const [forecast, setForecast] = useState<{ threshold: number; windows: { minutes: number; expectedOccupied: number; totalSpots: number; pct: number; atRisk: boolean }[] } | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ start: range.start, end: range.end });
    fetch(`/api/admin/analytics?${params}`).then(r => r.json()).then(a => {
      setMetrics(a);
      setCarrierStats(a.carrierStats || []);
      setLoading(false);
    });
  }, [range]);

  // null when there's no prior-period baseline (e.g. div-by-zero) — the
  // trend badge hides itself rather than show a fake/garbage percentage.
  const pctChange = (curr: number | null | undefined, prev: number | null | undefined): number | null => {
    if (curr == null || prev == null || prev === 0) return null;
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  };

  useEffect(() => {
    fetch("/api/admin/analytics/heatmap").then(r => r.json()).then(d => setHeatmap(d.grid)).catch(() => {});
    fetch("/api/admin/capacity-forecast").then(r => r.ok ? r.json() : null).then(setForecast).catch(() => {});
  }, []);

  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const heatmapMax = heatmap ? Math.max(1, ...heatmap.flat()) : 1;

  const tatChartData = {
    labels: carrierStats.map(c => c.carrier),
    datasets: [{
      label: "Average Dwell (min)",
      data: carrierStats.map(c => c.avg_dwell_mins),
      backgroundColor: "rgba(79, 70, 229, 0.6)",
      borderRadius: 8,
    }]
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
      <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      <span className="text-xs font-bold uppercase tracking-widest">Analyzing Data Sets...</span>
    </div>
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Executive Insights</h1>
          <p className="text-slate-500 font-medium mt-1">Terminal performance and carrier efficiency metrics.</p>
        </div>
        
        <div className="flex items-center gap-4 bg-white border border-slate-200 px-6 py-3 rounded-2xl shadow-sm">
          <Calendar size={18} className="text-indigo-600" />
          <div className="flex items-center gap-3">
            <input 
              type="date" value={range.start} onChange={e => setRange({...range, start: e.target.value})}
              className="text-sm font-semibold text-slate-600 bg-transparent focus:outline-none cursor-pointer"
            />
            <span className="text-slate-200">|</span>
            <input 
              type="date" value={range.end} onChange={e => setRange({...range, end: e.target.value})}
              className="text-sm font-semibold text-slate-600 bg-transparent focus:outline-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPIItem label="Total Movements" value={metrics?.current?.totalTrucks} trend={pctChange(metrics?.current?.totalTrucks, metrics?.previous?.totalTrucks)} icon={<Activity />} />
        <KPIItem label="Avg Dwell Time" value={`${Math.round(metrics?.current?.avgTat || 0)}m`} trend={pctChange(metrics?.current?.avgTat, metrics?.previous?.avgTat)} invert icon={<Clock />} />
        <KPIItem label="On-Time Rate" value={metrics?.current?.onTimeRate != null ? `${Math.round(metrics.current.onTimeRate)}%` : "—"} trend={pctChange(metrics?.current?.onTimeRate, metrics?.previous?.onTimeRate)} icon={<Target />} />
        <KPIItem label="SLA Breaches" value={metrics?.current?.detentionEvents} trend={pctChange(metrics?.current?.detentionEvents, metrics?.previous?.detentionEvents)} invert icon={<AlertCircle />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white border border-slate-200 p-8 rounded-3xl shadow-sm">
          <h3 className="font-bold text-slate-900 mb-8">Throughput by Carrier</h3>
          <div className="h-[350px]">
             <Bar 
              data={tatChartData} 
              options={{ 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { display: false } },
                scales: { 
                  y: { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b' } },
                  x: { grid: { display: false }, ticks: { color: '#64748b' } }
                } 
              }} 
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm space-y-6">
          <h3 className="font-bold text-slate-900">Carrier Efficiency</h3>
          <div className="space-y-4">
             {carrierStats.slice(0, 6).map((c, i) => (
                <div key={i} className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 transition-all hover:border-indigo-200">
                   <div>
                      <p className="font-bold text-slate-900 text-sm truncate max-w-[120px]">{c.carrier}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{c.total_visits} VISITS</p>
                   </div>
                   <div className="text-right">
                      <p className="font-bold text-slate-900 text-lg">{Math.round(c.avg_dwell_mins)}m</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.avg_dwell_mins < 120 ? 'bg-teal-50 text-teal-600' : 'bg-red-50 text-red-600'}`}>
                        {c.avg_dwell_mins < 120 ? 'Efficient' : 'Congested'}
                      </span>
                   </div>
                </div>
             ))}
          </div>
        </div>
      </div>

      {forecast && forecast.windows.length > 0 && (
        <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm">
          <div className="flex items-baseline justify-between mb-6">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <TrendingUp size={18} className="text-indigo-600" /> Capacity Forecast
            </h3>
            <p className="text-slate-500 text-sm">Risk threshold {forecast.threshold}% · from real scheduled arrivals/departures</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {forecast.windows.map((w) => (
              <div key={w.minutes} className={`rounded-2xl border p-4 ${w.atRisk ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-100"}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">In {w.minutes < 60 ? `${w.minutes}m` : `${w.minutes / 60}h`}</p>
                <p className={`text-2xl font-bold mt-1 ${w.atRisk ? "text-red-600" : "text-slate-900"}`}>{w.pct}%</p>
                <p className="text-slate-500 text-xs font-semibold">{w.expectedOccupied} / {w.totalSpots} spots</p>
                {w.atRisk && <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mt-1">Capacity risk</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {heatmap && (
        <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm">
          <h3 className="font-bold text-slate-900 text-lg mb-1 flex items-center gap-2">
            <BarChart3 size={18} className="text-indigo-600" /> Gate arrivals — day × hour
          </h3>
          <p className="text-slate-500 text-sm mb-6">Last 90 days, Monday-first week. Use for staffing and appointment-slot capacity planning.</p>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-1 mb-1">
                <div />
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="text-center text-[9px] font-bold text-slate-400">{h % 3 === 0 ? h : ""}</div>
                ))}
              </div>
              {DAY_LABELS.map((day, dayIdx) => (
                <div key={day} className="grid grid-cols-[40px_repeat(24,1fr)] gap-1 mb-1">
                  <div className="text-[10px] font-bold text-slate-400 flex items-center">{day}</div>
                  {heatmap[dayIdx].map((count, hour) => {
                    const intensity = count / heatmapMax;
                    return (
                      <div
                        key={hour}
                        title={`${day} ${hour}:00 — ${count} arrivals`}
                        className="aspect-square rounded-sm"
                        style={{ backgroundColor: intensity === 0 ? "#f1f5f9" : `rgba(79, 70, 229, ${0.15 + intensity * 0.85})` }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <DailyReport />
    </div>
  );
}

function DailyReport() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/reports/daily?date=${date}`).then((r) => r.ok ? r.json() : null).then(setReport).finally(() => setLoading(false));
  }, [date]);

  return (
    <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
          <Calendar size={18} className="text-indigo-600" /> Daily Yard Report
        </h3>
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none" />
          <button onClick={() => window.print()} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">Print</button>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Loading...</p>
      ) : !report ? (
        <p className="text-sm text-slate-400 py-8 text-center">No data for this date.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Trucks processed", value: report.totalTrucks },
            { label: "Avg dwell", value: report.avgDwellMinutes != null ? `${report.avgDwellMinutes}m` : "—" },
            { label: "On-time rate", value: report.onTimeRate != null ? `${report.onTimeRate}%` : "—" },
            { label: "Detention events", value: report.detentionEvents },
            { label: "Detention total", value: report.detentionTotal },
            { label: "Safety incidents", value: report.safetyIncidents },
            { label: "Exceptions raised", value: report.exceptions },
          ].map((s) => (
            <div key={s.label} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KPIItem({ label, value, trend, icon, invert }: any) {
  const isPos = trend > 0;
  const isGood = invert ? !isPos : isPos;
  return (
    <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm">
       <div className="flex justify-between items-start mb-6">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100 shadow-sm">
            {React.cloneElement(icon, { size: 22 })}
          </div>
          {trend != null && (
            <div className={`flex items-center gap-1 text-[11px] font-bold ${isGood ? 'text-teal-600' : 'text-red-600'}`}>
               {isPos ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
               {Math.abs(trend)}%
            </div>
          )}
       </div>
       <h4 className="text-3xl font-bold text-slate-900">{value ?? 0}</h4>
       <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">{label}</p>
    </div>
  );
}
