import React, { useState, useEffect } from "react";
import { Warehouse, Check, ChevronRight, ShieldCheck, ToggleLeft } from "lucide-react";

const EQUIPMENT_TYPES = ["standard", "reefer", "flatbed", "tanker", "hazmat", "oversized"];

export default function DockRules() {
  const [docks, setDocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/yard-status")
      .then(r => r.json())
      .then(data => {
        setDocks(data.spots.filter((s: any) => s.type === "DOCK"));
        setLoading(false);
      });
  }, []);

  const toggleDockRule = async (dockId: number, eType: string, isAdding: boolean) => {
    await fetch("/api/admin/dock-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dockId, eType, isAdding })
    });
    setDocks(prev => prev.map(d => {
      if (d.id === dockId) {
        const rules = d.allowed_equipment_types || ["standard"];
        const updated = isAdding ? [...rules, eType] : rules.filter((t: string) => t !== eType);
        return { ...d, allowed_equipment_types: updated };
      }
      return d;
    }));
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-pulse">
      <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      <span className="text-xs font-bold uppercase tracking-widest">Loading Protocols...</span>
    </div>
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Equipment Compatibility</h1>
          <p className="text-slate-500 font-medium">Define which equipment types are permitted at specific dock doors.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Dock Door</th>
                {EQUIPMENT_TYPES.map(t => (
                  <th key={t} className="px-4 py-5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docks.map(dock => (
                <tr key={dock.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all">
                        <Warehouse size={18} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 leading-tight">{dock.name}</p>
                        <p className="text-[11px] font-medium text-slate-400 mt-0.5">{dock.zone_name || 'Main Zone'}</p>
                      </div>
                    </div>
                  </td>
                  {EQUIPMENT_TYPES.map(eType => {
                    const allowed = dock.allowed_equipment_types || ["standard"];
                    const isAllowed = allowed.includes(eType);
                    return (
                      <td key={eType} className="px-4 py-5 text-center">
                        <button 
                          onClick={() => toggleDockRule(dock.id, eType, !isAllowed)}
                          className={`
                            relative w-6 h-6 rounded-lg border transition-all inline-flex items-center justify-center
                            ${isAllowed 
                              ? 'bg-teal-600 border-teal-600 text-white shadow-sm' 
                              : 'border-slate-200 text-transparent hover:border-teal-400 hover:bg-teal-50'}
                          `}
                        >
                          <Check size={14} className={isAllowed ? 'opacity-100' : 'opacity-0'} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl flex items-center gap-4">
        <ShieldCheck className="text-indigo-600 shrink-0" />
        <p className="text-sm font-medium text-indigo-900">
          Enforced when dispatch moves a trailer onto a dock — incompatible equipment types are rejected at that step.
        </p>
      </div>
    </div>
  );
}
