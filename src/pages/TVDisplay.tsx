import React, { useState, useEffect } from "react";
import { Clock, Truck, Warehouse, List, AlertTriangle, Activity, Globe, Cpu } from "lucide-react";

export default function TVDisplay() {
  const [data, setData] = useState<any>(null);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/yard-status");
        setData(await res.json());
      } catch (err) {
        console.error("TV sync error", err);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return (
    <div className="h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-screen w-screen bg-slate-950 text-white flex flex-col font-sans overflow-hidden">
      {/* Top Banner */}
      <header className="h-24 bg-slate-900 border-b border-slate-800 flex justify-between items-center px-12">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Warehouse size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Main Terminal Hub</h1>
            <p className="text-indigo-400 text-xs font-bold uppercase tracking-[0.3em]">Live Logistics Status</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-5xl font-bold font-mono tracking-tighter tabular-nums">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </p>
          <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-1">
             {time.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-[1fr_400px] gap-8 p-8">
        <div className="flex flex-col gap-8">
          {/* Summary KPIs */}
          <div className="grid grid-cols-3 gap-8">
            <TVStatCard label="In-Yard Fleet" value={data.stats.totalTrailers || 0} icon={<Truck size={48}/>} color="indigo" />
            <TVStatCard label="Dock Availability" value={data.spots.filter((s:any) => s.type === 'DOCK' && s.status === 'EMPTY').length} icon={<Warehouse size={48}/>} color="teal" />
            <TVStatCard label="Inbound Pipeline" value={data.appointments.length} icon={<List size={48}/>} color="amber" />
          </div>

          {/* Table Area */}
          <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-[2.5rem] p-8 overflow-hidden">
             <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold flex items-center gap-3">
                   <Activity className="text-indigo-500" /> Planned Movements
                </h3>
                <span className="px-4 py-1 bg-teal-500/10 text-teal-400 text-xs font-bold rounded-full border border-teal-500/20 animate-pulse">Syncing...</span>
             </div>
             <div className="space-y-4">
                {data.appointments.slice(0, 8).map((a:any) => (
                  <div key={a.id} className="flex justify-between items-center p-6 bg-slate-800/40 border border-slate-800 rounded-3xl">
                     <div className="flex items-center gap-12">
                        <span className="text-4xl font-bold text-indigo-400 tabular-nums">{a.start_time.split('T')[1].substring(0, 5)}</span>
                        <div>
                           <p className="text-2xl font-bold text-white">{a.carrier}</p>
                           <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Verified Entry Protocol</p>
                        </div>
                     </div>
                     <span className="text-3xl font-mono px-6 py-2 bg-slate-950 rounded-2xl border border-slate-800">{a.plate}</span>
                  </div>
                ))}
             </div>
          </div>
        </div>

        {/* Sidebar Alerts */}
        <aside className="bg-slate-900 border border-slate-800 rounded-[3rem] p-8 flex flex-col gap-8">
           <h3 className="text-lg font-bold flex items-center gap-3 text-red-400">
              <AlertTriangle /> Critical Notices
           </h3>
           <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 opacity-30">
              <Globe size={120} className="text-slate-700" />
              <p className="text-sm font-bold uppercase tracking-widest">Network Surveillance Online</p>
           </div>
           <div className="p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-3xl text-indigo-300 text-center">
              <p className="text-xs font-bold uppercase tracking-widest leading-loose">Shift Change in 18m<br/>Stand by for handover</p>
           </div>
        </aside>
      </main>
    </div>
  );
}

function TVStatCard({ label, value, icon, color }: any) {
  const colors: any = {
    indigo: 'from-indigo-600/20 text-indigo-400 border-indigo-500/30',
    teal: 'from-teal-600/20 text-teal-400 border-teal-500/30',
    amber: 'from-amber-600/20 text-amber-400 border-amber-500/30'
  };
  return (
    <div className={`bg-gradient-to-br bg-slate-900 border ${colors[color]} p-10 rounded-[3rem] shadow-xl flex flex-col items-center gap-4 text-center group`}>
       <div className="opacity-40 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500">{icon}</div>
       <div>
          <p className="text-[11rem] font-bold tracking-tighter leading-none">{value}</p>
          <p className="text-sm font-bold uppercase tracking-[0.3em] opacity-60 mt-2">{label}</p>
       </div>
    </div>
  );
}
