import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

export interface PresenceUser {
  id: string;
  name: string;
  initials: string;
  color: string;
  page: string;
  lastSeen: string;
  cursor?: { x: number; y: number };
}

const COLORS = ["#0F5CA8", "#0A6B52", "#7A4509", "#4A42A8", "#991F1F", "#1A5F7A", "#5C3D8F"];

export function usePresence(facilityId: number, userName: string) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    const myPresence: PresenceUser = {
      id: Math.random().toString(36).substr(2, 9),
      name: userName,
      initials: userName.split(" ").map(n => n[0]).join(""),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      page: window.location.pathname,
      lastSeen: new Date().toISOString()
    };

    socket.emit("join-facility", { facilityId, user: myPresence });

    socket.on("presence-update", (users: PresenceUser[]) => {
      setOnlineUsers(users.filter(u => u.id !== myPresence.id));
    });

    const pathHandler = () => {
      socket.emit("update-page", { facilityId, userId: myPresence.id, page: window.location.pathname });
    };

    window.addEventListener("popstate", pathHandler);
    
    return () => {
      socket.disconnect();
      window.removeEventListener("popstate", pathHandler);
    };
  }, [facilityId, userName]);

  const broadcastCursor = (x: number, y: number) => {
    socketRef.current?.emit("cursor-move", { facilityId, x, y });
  };

  return { onlineUsers, broadcastCursor };
}
