import React, { useState, useEffect } from "react";
import { Plus, Table, BarChart, PieChart, LineChart, Save, Download, ChevronRight, X, GripVertical } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

const AVAILABLE_METRICS = [
  { id: "m1", label: "Average TAT (Truck Turnaround Time)", category: "Gate" },
  { id: "m2", label: "Dock Utilization %", category: "Docks" },
  { id: "m3", label: "Detention Revenue", category: "Finance" },
  { id: "m4", label: "No-Show Rate", category: "Appointments" },
  { id: "m5", label: "Peak Hour Volume", category: "Gate" },
];

export default function ReportBuilder() {
  const [selectedMetrics, setSelectedMetrics] = useState<any[]>([]);
  const [chartType, setChartType] = useState("bar");
  const [reportName, setReportName] = useState("");
  const [isPivotMode, setIsPivotMode] = useState(false);
  const { showToast } = useToast();

  const handleAddMetric = (metric: any) => {
    if (selectedMetrics.find(m => m.id === metric.id)) return;
    setSelectedMetrics([...selectedMetrics, metric]);
  };

  const handleRemoveMetric = (id: string) => {
    setSelectedMetrics(selectedMetrics.filter(m => m.id !== id));
  };

  const handleSave = async () => {
    if (!reportName) return showToast("Please give your report a name", "error");
    
    const config = {
      metrics: selectedMetrics.map(m => m.id),
      chartType,
      isPivotMode
    };

    try {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: reportName, description: "Custom BI Report", config })
      });
      if (res.ok) showToast("Report saved to library", "success");
    } catch (e) {
      showToast("Failed to save report", "error");
    }
  };

  return (
    <div className="h-full flex flex-col gap-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-bold tracking-tight text-slate-900 leading-none">Report Builder <span className="text-slate-400 font-medium">2.0</span></h2>
          <p className="text-slate-500 font-medium mt-2 text-lg">Visual multi-metric BI configurator.</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-white border border-slate-200 text-slate-600 px-5 py-3 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2">
            <Download size={18}/> Export CSV
          </button>
          <button 
            onClick={handleSave}
            className="bg-indigo-600 text-white px-6 py-3 rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
          >
            <Save size={18}/> Save Report
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8 min-h-0">
        {/* Metric Library */}
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-[2rem] p-6 flex flex-col gap-6 shadow-sm">
          <h3 className="font-bold text-slate-900 border-b border-slate-50 pb-4">Metric Library</h3>
          <div className="space-y-4">
            {AVAILABLE_METRICS.map(m => (
              <button 
                key={m.id}
                onClick={() => handleAddMetric(m)}
                className="w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 text-left hover:border-indigo-600 group transition-all"
              >
                <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest leading-none mb-1">{m.category}</p>
                <p className="text-sm font-bold text-slate-700 leading-tight group-hover:text-indigo-700">{m.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Builder Canvas */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {/* Controls */}
          <div className="bg-white border border-slate-200 p-6 rounded-[2rem] shadow-sm flex flex-wrap items-center justify-between gap-6">
            <div className="flex-1 min-w-[200px]">
              <input 
                placeholder="Untitled Report..."
                value={reportName}
                onChange={e => setReportName(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-2xl font-bold text-slate-900 placeholder:text-slate-200"
              />
            </div>
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
               <ChartTypeButton id="bar" icon={<BarChart size={18}/>} active={chartType === 'bar'} onClick={setChartType} />
               <ChartTypeButton id="line" icon={<LineChart size={18}/>} active={chartType === 'line'} onClick={setChartType} />
               <ChartTypeButton id="pie" icon={<PieChart size={18}/>} active={chartType === 'pie'} onClick={setChartType} />
               <ChartTypeButton id="table" icon={<Table size={18}/>} active={chartType === 'table'} onClick={setChartType} />
            </div>
            <div className="flex items-center gap-3 border-l border-slate-100 pl-6 ml-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Pivot View</span>
              <button 
                onClick={() => setIsPivotMode(!isPivotMode)}
                className={`w-12 h-6 rounded-full transition-colors relative ${isPivotMode ? 'bg-indigo-600' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isPivotMode ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>

          {/* Active Metrics */}
          <div className="flex flex-wrap gap-3">
             {selectedMetrics.map(m => (
               <div key={m.id} className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm">
                  <GripVertical size={12} className="text-indigo-300" />
                  {m.label}
                  <button onClick={() => handleRemoveMetric(m.id)}><X size={14}/></button>
               </div>
             ))}
             {selectedMetrics.length === 0 && (
               <p className="text-slate-400 text-sm font-medium italic py-2 px-1">Drag and drop metrics from the library to start building...</p>
             )}
          </div>

          {/* Preview Canvas */}
          <div className="flex-1 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[3rem] flex items-center justify-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
               <div className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold shadow-xl flex items-center gap-2">
                  <Plus size={20}/> Generate Preview
               </div>
            </div>
            
            {selectedMetrics.length > 0 ? (
              <div className="p-12 text-center space-y-4">
                <div className="flex justify-center gap-4">
                   <div className="h-40 w-8 bg-indigo-500 rounded-lg animate-pulse" style={{ animationDelay: '100ms'}} />
                   <div className="h-60 w-8 bg-indigo-400 rounded-lg animate-pulse" style={{ animationDelay: '200ms'}} />
                   <div className="h-32 w-8 bg-indigo-600 rounded-lg animate-pulse" style={{ animationDelay: '300ms'}} />
                   <div className="h-52 w-8 bg-indigo-300 rounded-lg animate-pulse" style={{ animationDelay: '400ms'}} />
                </div>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Real-time {chartType} preview simulation</p>
              </div>
            ) : (
              <div className="text-center space-y-4">
                 <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                    <Table size={32}/>
                 </div>
                 <p className="text-slate-400 font-medium max-w-[240px]">Select metrics from the left panel to visualize terminal data.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartTypeButton({ icon, active, onClick, id }: any) {
  return (
    <button 
      onClick={() => onClick(id)}
      className={`p-3 rounded-xl transition-all ${active ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
    >
      {icon}
    </button>
  );
}
