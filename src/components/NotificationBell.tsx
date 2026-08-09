import React, { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";

interface Notif {
  id: number;
  title: string;
  body: string;
  link?: string;
  created_at: string;
}

const SCOPE_URLS: Record<string, { list: string; read: (id: number) => string; readAll?: string }> = {
  admin: { list: "/api/notifications/inapp?userType=ADMIN", read: (id) => `/api/notifications/inapp/${id}/read`, readAll: "/api/notifications/inapp/read-all" },
  carrier: { list: "/api/carrier/notifications", read: (id) => `/api/carrier/notifications/${id}/read` },
  driver: { list: "/api/driver/notifications", read: (id) => `/api/driver/notifications/${id}/read` },
};

export default function NotificationBell({ scope = "admin" }: { scope?: "admin" | "carrier" | "driver" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const socketRef = useRef<any>(null);
  const navigate = useNavigate();
  const urls = SCOPE_URLS[scope];

  const load = async () => {
    try {
      const res = await fetch(urls.list);
      if (res.ok) setItems(await res.json());
    } catch {}
  };

  useEffect(() => {
    load();
    socketRef.current = io();
    socketRef.current.on("new_notification", () => load());
    return () => socketRef.current?.disconnect();
  }, [scope]);

  const markAllRead = async () => {
    if (urls.readAll) {
      await fetch(urls.readAll, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userType: "ADMIN" }) });
    } else {
      await Promise.all(items.map((n) => fetch(urls.read(n.id), { method: "POST" }).catch(() => {})));
    }
    setItems([]);
  };

  const openNotification = async (n: Notif) => {
    setItems((prev) => prev.filter((i) => i.id !== n.id));
    fetch(urls.read(n.id), { method: "POST" }).catch(() => {});
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications" className="p-2 text-slate-400 hover:text-slate-600 relative">
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
                <button key={n.id} onClick={() => openNotification(n)} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                  <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
