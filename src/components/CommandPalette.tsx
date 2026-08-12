import React, { useState, useEffect, useRef } from "react";
import { Search, Command, History, ArrowRight, Zap, Target, Loader2, ShieldAlert, HardHat, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isHidden } from "../lib/permissions";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>({ actions: [], recent: [], entities: [] });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Same HIDDEN_ROUTES filter the nav and the route guard use — otherwise
  // Cmd+K stays a working back door into a section that's switched off.
  const actions = [
    { id: "act-1", label: "Dashboard Overview", to: "/", shortcut: "G D", icon: <Zap size={16}/> },
    { id: "act-2", label: "Appointments Calendar", to: "/calendar", shortcut: "G C", icon: <Command size={16}/> },
    { id: "act-6", label: "Gate & Check-in", to: "/gate", shortcut: "G G", icon: <Target size={16}/> },
    { id: "act-9", label: "Live Tracking", to: "/tracking", shortcut: "G T", icon: <Target size={16}/> },
    { id: "act-7", label: "Dispatch Board", to: "/dispatch", shortcut: "G B", icon: <Command size={16}/> },
    { id: "act-10", label: "Exceptions", to: "/exceptions", shortcut: "G E", icon: <ShieldAlert size={16}/> },
    { id: "act-11", label: "Safety Center", to: "/safety", shortcut: "G Y", icon: <HardHat size={16}/> },
    { id: "act-12", label: "Documents", to: "/documents", shortcut: "G O", icon: <FileText size={16}/> },
    { id: "act-3", label: "Network Topology", to: "/network", shortcut: "G N", icon: <Target size={16}/> },
    { id: "act-4", label: "Financial Records", to: "/finance", shortcut: "G F", icon: <History size={16}/> },
    { id: "act-8", label: "Settings", to: "/settings", shortcut: "G ,", icon: <History size={16}/> },
    { id: "act-5", label: "Design System", to: "/design", shortcut: "G S", icon: <History size={16}/> },
  ]
    .filter((a) => !isHidden(a.to))
    .map((a) => ({ ...a, action: () => navigate(a.to) }));

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // "G then <letter>" chords, matching the shortcut hints already shown next
  // to each quick action below — those hints did nothing until now.
  const pendingGRef = useRef(false);
  const pendingGTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      const tag = (el as HTMLElement)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (open || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (pendingGRef.current) {
        pendingGRef.current = false;
        if (pendingGTimer.current) clearTimeout(pendingGTimer.current);
        const match = actions.find((a) => a.shortcut.toLowerCase() === `g ${e.key.toLowerCase()}`);
        if (match) {
          e.preventDefault();
          match.action();
        }
      } else if (e.key.toLowerCase() === "g") {
        pendingGRef.current = true;
        pendingGTimer.current = setTimeout(() => { pendingGRef.current = false; }, 1000);
      }
    };
    document.addEventListener("keydown", down);
    return () => {
      document.removeEventListener("keydown", down);
      if (pendingGTimer.current) clearTimeout(pendingGTimer.current);
    };
  }, [open]);

  useEffect(() => {
    if (query.length < 2) {
      setResults(prev => ({ ...prev, entities: [] }));
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
          setResults(prev => ({ ...prev, entities: data || [] }));
          setLoading(false);
        });
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const filteredActions = actions.filter(a => 
    a.label.toLowerCase().includes(query.toLowerCase())
  );

  const flatResults = [
    ...filteredActions.map(a => ({ ...a, type: "action" })),
    ...results.entities.map((e: any) => ({ ...e, type: "entity" }))
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => (i - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = flatResults[selectedIndex];
      if (selected) {
        if (selected.type === "action") {
          selected.action();
        } else {
          navigate(selected.url);
        }
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div 
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm transition-opacity"
        onClick={() => setOpen(false)}
      />
      
      <div 
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col motion-spring-pop"
        onKeyDown={handleKeyDown}
      >
        <div className="p-6 border-b border-slate-100 flex items-center gap-4">
          {loading ? <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" /> : <Search className="w-5 h-5 text-slate-400" />}
          <input 
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search network, appointments, or commands..."
            className="flex-1 bg-transparent border-none outline-none text-lg font-medium text-slate-900 placeholder:text-slate-400"
          />
          <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-md">
            <span className="text-[10px] font-bold text-slate-500">ESC</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[400px] p-2 custom-scrollbar">
          {flatResults.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-slate-400 font-medium">No results found for "{query}"</p>
            </div>
          )}

          {filteredActions.length > 0 && (
            <div className="p-2">
              <p className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quick Actions</p>
              {filteredActions.map((action, idx) => (
                <ResultItem 
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  shortcut={action.shortcut}
                  selected={selectedIndex === idx}
                  onClick={() => { action.action(); setOpen(false); }}
                />
              ))}
            </div>
          )}

          {results.entities.length > 0 && (
            <div className="p-2 border-t border-slate-50">
              <p className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global Search</p>
              {results.entities.map((entity: any, idx: number) => (
                <ResultItem 
                  key={entity.id}
                  icon={<div className="w-4 h-4 rounded-full bg-indigo-100" />}
                  label={entity.title}
                  sub={entity.subtitle}
                  selected={selectedIndex === (filteredActions.length + idx)}
                  onClick={() => { navigate(entity.url); setOpen(false); }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex gap-4">
            <span className="flex items-center gap-1"><ArrowRight size={10}/> Select</span>
            <span className="flex items-center gap-1">↑↓ Navigate</span>
          </div>
          <span>Powered by SkyYard Quantum Search</span>
        </div>
      </div>
    </div>
  );
}

function ResultItem({ icon, label, sub, shortcut, selected, onClick }: any) {
  return (
    <div 
      className={`
        flex items-center justify-between p-3 rounded-2xl cursor-pointer transition-all
        ${selected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'hover:bg-slate-50 text-slate-700'}
      `}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`${selected ? 'text-white' : 'text-slate-400'}`}>{icon}</div>
        <div>
          <p className="text-sm font-bold leading-none">{label}</p>
          {sub && <p className={`text-[10px] mt-1 font-medium ${selected ? 'text-indigo-100' : 'text-slate-400'}`}>{sub}</p>}
        </div>
      </div>
      {shortcut && (
        <div className={`px-2 py-1 rounded-md text-[9px] font-bold ${selected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
          {shortcut}
        </div>
      )}
    </div>
  );
}
