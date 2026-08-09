import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Activity, Globe, Cpu, Server, MapPin, CheckCircle2, ChevronRight, LayoutGrid } from "lucide-react";

export default function NetworkDashboard() {
  const [facilities, setFacilities] = useState<any[]>([]);
  const [globalLoadPct, setGlobalLoadPct] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNetworkData = async () => {
    try {
      const res = await fetch("/api/superadmin/network");
      if (!res.ok) throw new Error("Failed to load network data");
      const data = await res.json();
      setFacilities(data.facilities || []);
      setGlobalLoadPct(data.globalLoadPct || 0);
    } catch (e) {
      console.error("Fetch facilities error:", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchNetworkData();
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
      <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      <span className="text-xs font-bold uppercase tracking-widest">Syncing Global Nodes...</span>
    </div>
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Global Network</h1>
          <p className="text-slate-500 font-medium mt-1">Multi-site terminal analytics and connectivity.</p>
        </div>
        
        <div className="bg-white border border-slate-200 px-6 py-3 rounded-2xl flex items-center gap-6 shadow-sm">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global Load</span>
            <span className="text-xl font-bold text-indigo-600">{globalLoadPct}%</span>
          </div>
          <div className="w-[1px] h-8 bg-slate-100" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Sites</span>
            <span className="text-xl font-bold text-slate-900">{facilities.length}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {facilities.map(facility => (
          <FacilityCard key={facility.id} facility={facility} />
        ))}
      </div>
    </div>
  );
}

function FacilityCard({ facility }: any) {
  const scoreColor = facility.healthScore >= 80 ? "text-teal-600" : facility.healthScore >= 60 ? "text-amber-600" : "text-red-600";
  const scoreBg = facility.healthScore >= 80 ? "bg-teal-50" : facility.healthScore >= 60 ? "bg-amber-50" : "bg-red-50";

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-8 hover:border-indigo-600 transition-all group hover:shadow-xl">
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-slate-900 leading-tight group-hover:text-indigo-600 transition-colors">{facility.name}</h3>
          <div className="flex items-center gap-2 text-slate-400">
            <MapPin size={12} />
            <span className="text-xs font-semibold">{facility.location || "Operational Hub"}</span>
          </div>
        </div>
        <div className={`px-4 py-2 rounded-xl text-center ${scoreBg}`}>
          <div className={`text-2xl font-bold ${scoreColor}`}>{Math.round(facility.healthScore)}</div>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Score</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In-Yard</p>
          <p className="text-2xl font-bold text-slate-900">{facility.activeTrucks}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Alerts</p>
          <p className={`text-2xl font-bold ${facility.openAlerts > 0 ? 'text-red-600' : 'text-slate-900'}`}>{facility.openAlerts}</p>
        </div>
      </div>

      <button className="w-full flex items-center justify-between p-4 bg-slate-50 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-all text-slate-600">
         <span className="text-sm font-bold">View Site Details</span>
         <ChevronRight size={18} />
      </button>
    </div>
  );
}
