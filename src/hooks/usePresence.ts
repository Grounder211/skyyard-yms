import { useState, useEffect, useRef } from "react";
import { useSocket } from "../contexts/SocketContext";

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
  const socket = useSocket();
  const socketRef = useRef<any>(null);
  socketRef.current = socket;

  useEffect(() => {
    if (!socket) return;

    const myPresence: PresenceUser = {
      id: Math.random().toString(36).substr(2, 9),
      name: userName,
      initials: userName.split(" ").map(n => n[0]).join(""),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      page: window.location.pathname,
      lastSeen: new Date().toISOString()
    };

    socket.emit("join-facility", { facilityId, user: myPresence });

    const onPresenceUpdate = (users: PresenceUser[]) => {
      setOnlineUsers(users.filter(u => u.id !== myPresence.id));
    };
    socket.on("presence-update", onPresenceUpdate);

    const pathHandler = () => {
      socket.emit("update-page", { facilityId, userId: myPresence.id, page: window.location.pathname });
    };

    window.addEventListener("popstate", pathHandler);

    return () => {
      socket.off("presence-update", onPresenceUpdate);
      window.removeEventListener("popstate", pathHandler);
    };
  }, [socket, facilityId, userName]);

  const broadcastCursor = (x: number, y: number) => {
    socketRef.current?.emit("cursor-move", { facilityId, x, y });
  };

  return { onlineUsers, broadcastCursor };
}
