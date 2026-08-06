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

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ start: range.start, end: range.end });
    Promise.all([
      fetch(`/api/period-stats?${params}`).then(r => r.json()),
      fetch(`/api/admin/analytics?${params}`).then(r => r.json())
    ]).then(([m, a]) => {
      setMetrics(m);
      setCarrierStats(a.carrierStats || []);
      setLoading(false);
    });
  }, [range]);

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
        <KPIItem label="Total Movements" value={metrics?.total_movements} trend={12} icon={<Activity />} />
        <KPIItem label="Avg Dwell Time" value={`${Math.round(metrics?.avg_tat || 0)}m`} trend={-8} icon={<Clock />} />
        <KPIItem label="On-Time Rate" value={`${Math.round(metrics?.on_time_rate || 0)}%`} trend={4} icon={<Target />} />
        <KPIItem label="SLA Breaches" value={metrics?.detention_events} trend={-2} icon={<AlertCircle />} />
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
    </div>
  );
}

function KPIItem({ label, value, trend, icon }: any) {
  const isPos = trend > 0;
  return (
    <div className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm">
       <div className="flex justify-between items-start mb-6">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100 shadow-sm">
            {React.cloneElement(icon, { size: 22 })}
          </div>
          <div className={`flex items-center gap-1 text-[11px] font-bold ${isPos ? 'text-teal-600' : 'text-red-600'}`}>
             {isPos ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
             {Math.abs(trend)}%
          </div>
       </div>
       <h4 className="text-3xl font-bold text-slate-900">{value || 0}</h4>
       <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">{label}</p>
    </div>
  );
}
