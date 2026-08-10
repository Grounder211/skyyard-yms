import React, { useState, useEffect } from "react";
import { Plus, Table, BarChart, PieChart, LineChart, Save, Download, ChevronRight, X, GripVertical, Loader2 } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

const AVAILABLE_METRICS = [
  { id: "m1", label: "Average TAT (Truck Turnaround Time)", category: "Gate" },
  { id: "m2", label: "Dock Utilization %", category: "Docks" },
  { id: "m3", label: "Detention Revenue", category: "Finance" },
  { id: "m4", label: "No-Show Rate", category: "Appointments" },
  { id: "m5", label: "Peak Hour Volume", category: "Gate" },
  { id: "m6", label: "Gate Throughput (In/Out)", category: "Gate" },
];

export default function ReportBuilder() {
  const [selectedMetrics, setSelectedMetrics] = useState<any[]>([]);
  const [chartType, setChartType] = useState("bar");
  const [reportName, setReportName] = useState("");
  const [isPivotMode, setIsPivotMode] = useState(false);
  const { toast } = useToast();

  const [results, setResults] = useState<any[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savedReports, setSavedReports] = useState<any[]>([]);

  const loadSavedReports = () => {
    fetch("/api/admin/reports").then((r) => (r.ok ? r.json() : [])).then((d) => setSavedReports(Array.isArray(d) ? d : [])).catch(() => {});
  };
  useEffect(loadSavedReports, []);

  const loadReport = (r: any) => {
    const config = r.config_json || {};
    setReportName(r.name || "");
    setSelectedMetrics(AVAILABLE_METRICS.filter((m) => (config.metrics || []).includes(m.id)));
    setChartType(config.chartType || "bar");
    setIsPivotMode(!!config.isPivotMode);
    setResults(null);
  };

  const handleAddMetric = (metric: any) => {
    if (selectedMetrics.find(m => m.id === metric.id)) return;
    setSelectedMetrics([...selectedMetrics, metric]);
    setResults(null);
  };

  const handleRemoveMetric = (id: string) => {
    setSelectedMetrics(selectedMetrics.filter(m => m.id !== id));
    setResults(null);
  };

  const handleGeneratePreview = async () => {
    if (selectedMetrics.length === 0) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/analytics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: selectedMetrics.map((m) => m.id), days: 30 }),
      });
      const data = await res.json();
      if (res.ok) setResults(data.metrics);
      else toast(data.error || "Failed to generate preview", "error");
    } catch {
      toast("Network error generating preview", "error");
    }
    setGenerating(false);
  };

  const handleExportCsv = () => {
    if (!results || results.length === 0) return;
    const header = "metric,value,unit,sample_size";
    const rows = results.map((r) => `"${r.label}",${r.value},"${r.unit}",${r.sampleSize}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportName || "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!reportName) return toast("Please give your report a name", "error");

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
      if (res.ok) {
        toast("Report saved to library", "success");
        loadSavedReports();
      } else toast("Failed to save report", "error");
    } catch (e) {
      toast("Failed to save report", "error");
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
          <button onClick={handleExportCsv} disabled={!results} className="bg-white border border-slate-200 text-slate-600 px-5 py-3 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
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
          {savedReports.length > 0 && (
            <div className="border-t border-slate-50 pt-4 space-y-2">
              <h3 className="font-bold text-slate-900 text-sm">Saved reports</h3>
              {savedReports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadReport(r)}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-100 text-left hover:border-indigo-600 transition-all"
                >
                  <p className="text-sm font-bold text-slate-700 truncate">{r.name}</p>
                  <p className="text-[10px] text-slate-400">{(r.config_json?.metrics || []).length} metrics</p>
                </button>
              ))}
            </div>
          )}
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
          <div className="flex-1 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[3rem] flex items-center justify-center relative overflow-hidden group p-8">
            {selectedMetrics.length === 0 && (
              <div className="text-center space-y-4">
                 <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                    <Table size={32}/>
                 </div>
                 <p className="text-slate-400 font-medium max-w-[240px]">Select metrics from the left panel to visualize terminal data.</p>
              </div>
            )}

            {selectedMetrics.length > 0 && !results && (
              <button
                onClick={handleGeneratePreview}
                disabled={generating}
                className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold shadow-xl flex items-center gap-2 hover:bg-indigo-700 transition-all disabled:opacity-60"
              >
                {generating ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20}/>} Generate Preview
              </button>
            )}

            {results && (
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
                {results.map((r) => (
                  <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-5 text-left">
                    <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-1">{r.label}</p>
                    <p className="text-3xl font-black text-slate-900">
                      {r.unit === "currency" ? `$${r.value.toLocaleString()}` : r.value.toLocaleString()}
                      {r.unit !== "currency" && r.unit !== "min" && <span className="text-sm font-bold text-slate-400 ml-1">{r.unit}</span>}
                      {r.unit === "min" && <span className="text-sm font-bold text-slate-400 ml-1">min avg</span>}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">Last 30 days · {r.sampleSize} records</p>
                  </div>
                ))}
                <button onClick={handleGeneratePreview} disabled={generating} className="sm:col-span-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 py-2 flex items-center justify-center gap-1.5">
                  {generating && <Loader2 size={12} className="animate-spin" />} Refresh
                </button>
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
