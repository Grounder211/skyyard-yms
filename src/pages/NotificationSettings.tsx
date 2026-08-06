import React, { useState, useEffect } from "react";
import { Bell, Smartphone, Mail, MessageSquare, Shield, Clock, Save, Loader2 } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

const EVENT_TYPES = [
  { id: "check_in_confirmed", label: "Check-in Confirmed", description: "Triggered when a vehicle is assigned a parking spot." },
  { id: "dock_assigned", label: "Dock Assigned", description: "Sent when a trailer is ready for loading/unloading." },
  { id: "dwell_alert", label: "Dwell Threshold Alert", description: "Warning when a vehicle exceeds the free time limit." },
  { id: "sla_breach", label: "SLA Breach", description: "Critical alert for missed turnaround targets." },
  { id: "broadcast", label: "Site Broadcasts", description: "General announcements from terminal management." },
];

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    fetch("/api/settings/notifications")
      .then(res => res.json())
      .then(data => {
        // Map data or use defaults
        const initial = EVENT_TYPES.map(event => {
          const existing = data.find((d: any) => d.event_type === event.id);
          return existing || {
            event_type: event.id,
            channel_sms: 0,
            channel_email: 1,
            channel_inapp: 1,
            channel_whatsapp: 0
          };
        });
        setPrefs(initial);
        setLoading(false);
      });
  }, []);

  const toggleChannel = (eventId: string, channel: string) => {
    setPrefs(prev => prev.map(p => 
      p.event_type === eventId 
        ? { ...p, [channel]: p[channel] ? 0 : 1 }
        : p
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs })
      });
      if (res.ok) showToast("Preferences updated", "success");
    } catch (e) {
      showToast("Sync failed", "error");
    }
    setSaving(false);
  };

  if (loading) return <div className="p-20 text-center animate-pulse text-slate-400 font-medium">Syncing notification nodes...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-12">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-bold tracking-tight text-slate-900 leading-none">Notifications</h2>
          <p className="text-slate-500 font-medium mt-2 text-lg">Omnichannel delivery preferences.</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin"/> : <Save size={18}/>}
          Save Preferences
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-sm">
        <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-100 p-6 px-10">
          <div className="col-span-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Event Protocol</div>
          <div className="col-span-1.5 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">In-App</div>
          <div className="col-span-1.5 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Email</div>
          <div className="col-span-1.5 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">SMS</div>
          <div className="col-span-1.5 text-center text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">WhatsApp</div>
          <div className="col-span-1 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Push</div>
        </div>

        <div className="divide-y divide-slate-50">
          {EVENT_TYPES.map(event => {
            const p = prefs.find(x => x.event_type === event.id);
            return (
              <div key={event.id} className="grid grid-cols-12 items-center p-8 px-10 hover:bg-slate-50/50 transition-colors">
                <div className="col-span-5 pr-8">
                  <p className="font-bold text-slate-900 text-lg mb-1">{event.label}</p>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed">{event.description}</p>
                </div>
                <ChannelToggle active={p?.channel_inapp} onClick={() => toggleChannel(event.id, 'channel_inapp')} />
                <ChannelToggle active={p?.channel_email} onClick={() => toggleChannel(event.id, 'channel_email')} />
                <ChannelToggle active={p?.channel_sms} onClick={() => toggleChannel(event.id, 'channel_sms')} />
                <ChannelToggle active={p?.channel_whatsapp} onClick={() => toggleChannel(event.id, 'channel_whatsapp')} color="indigo" />
                <ChannelToggle active={true} disabled />
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-slate-900 rounded-[2rem] p-8 text-white flex flex-col gap-6">
           <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white">
              <Clock size={24}/>
           </div>
           <div>
              <h3 className="text-xl font-bold">Quiet Hours</h3>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">During these hours, only CRITICAL severity notifications will be sent to external channels.</p>
           </div>
           <div className="flex items-center gap-4 mt-auto">
              <input type="time" defaultValue="22:00" className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm font-bold" />
              <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">TO</span>
              <input type="time" defaultValue="06:00" className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm font-bold" />
           </div>
        </div>

        <div className="bg-indigo-600 rounded-[2rem] p-8 text-white flex flex-col gap-6 shadow-xl shadow-indigo-200">
           <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-white">
              <Smartphone size={24}/>
           </div>
           <div>
              <h3 className="text-xl font-bold">Smart Timing</h3>
              <p className="text-indigo-100 text-sm mt-2 leading-relaxed">Our AI learns when you are most active and optimizes delivery windows to increase engagement.</p>
           </div>
           <div className="flex items-center gap-3 mt-auto">
              <div className="px-4 py-2 bg-white text-indigo-600 rounded-xl text-xs font-bold uppercase tracking-tighter">EXPERIMENTAL FEATURE</div>
              <button className="text-white/60 hover:text-white text-xs font-bold underline transition-colors">Documentation</button>
           </div>
        </div>
      </div>
    </div>
  );
}

function ChannelToggle({ active, onClick, disabled, color = "slate" }: any) {
  const activeColor = color === 'indigo' ? 'bg-indigo-600' : 'bg-slate-900';
  return (
    <div className="col-span-1.5 flex justify-center">
      <button 
        onClick={onClick}
        disabled={disabled}
        className={`w-12 h-6 rounded-full transition-all relative ${active ? activeColor : 'bg-slate-200'} ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${active ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}
