import React, { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

// One socket for the whole authenticated session, shared by every page/
// component that needs real-time updates — previously every page opened
// its own io() connection (NotificationBell, usePresence, and whichever
// page was active all polling in parallel), tripling socket.io traffic
// on every screen.
// `undefined` (the default, outside any Provider) means "no shared socket
// here — open your own", distinct from `null` ("provider exists, still
// connecting — wait"). NotificationBell renders inside both the staff app
// shell (which provides this) and the standalone Carrier/Driver portals
// (which don't) and needs to tell those two cases apart.
const SocketContext = createContext<Socket | null | undefined>(undefined);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io();
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null | undefined {
  return useContext(SocketContext);
}
