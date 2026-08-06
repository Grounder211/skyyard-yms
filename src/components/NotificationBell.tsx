import React, { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { io } from "socket.io-client";

interface Notif {
  id: number;
  title: string;
  body: string;
  link?: string;
  created_at: string;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const socketRef = useRef<any>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/notifications/inapp?userType=ADMIN`);
      if (res.ok) setItems(await res.json());
    } catch {}
  };

  useEffect(() => {
    load();
    socketRef.current = io();
    socketRef.current.on("new_notification", () => load());
    return () => socketRef.current?.disconnect();
  }, []);

  const markAllRead = async () => {
    await fetch("/api/notifications/inapp/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userType: "ADMIN" }),
    });
    setItems([]);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="p-2 text-slate-400 hover:text-slate-600 relative">
        <Bell size={20} />
        {items.length > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white animate-pulse" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="font-bold text-sm text-slate-900">Notifications</span>
              {items.length > 0 && (
                <button onClick={markAllRead} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
              {items.length === 0 && <p className="p-6 text-center text-xs text-slate-400">You're all caught up.</p>}
              {items.map((n) => (
                <div key={n.id} className="px-4 py-3 hover:bg-slate-50">
                  <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
