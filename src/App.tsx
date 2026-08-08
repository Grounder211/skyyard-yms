import React, { Suspense } from "react";
import {
  Truck,
  Warehouse,
  LayoutDashboard,
  LogOut,
  Calendar,
  Clock,
  BarChart3,
  Globe,
  Menu,
  ChevronRight,
  DollarSign,
  Search,
  Settings as SettingsIcon,
  Activity,
  DoorOpen,
  Palette,
  ScanLine,
  ArrowRightLeft,
  ShieldCheck,
  Radar,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { motion } from "motion/react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { ToastProvider } from "./contexts/ToastContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { I18nProvider, useI18n } from "./lib/i18n";
import { use3DTilt } from "./hooks/use3DTilt";
import { Reveal, CountUp } from "./components/MotionProviders";
import CommandPalette from "./components/CommandPalette";
import NotificationBell from "./components/NotificationBell";
import { usePresence } from "./hooks/usePresence";
import Login from "./pages/Login";
import { canAccess, ROLE_LABELS } from "./lib/permissions";

import AppointmentCalendar from "./components/AppointmentCalendar";
const ExecutiveDashboard = React.lazy(() => import("./pages/ExecutiveDashboard"));
const TVDisplay = React.lazy(() => import("./pages/TVDisplay"));
const DockRules = React.lazy(() => import("./pages/DockRules"));
const NetworkDashboard = React.lazy(() => import("./pages/NetworkDashboard"));
const AccountsReceivable = React.lazy(() => import("./pages/AccountsReceivable"));
const ReportBuilder = React.lazy(() => import("./pages/ReportBuilder"));
const NotificationSettings = React.lazy(() => import("./pages/NotificationSettings"));
const GateConsole = React.lazy(() => import("./pages/GateConsole"));
const DispatchBoard = React.lazy(() => import("./pages/DispatchBoard"));
const PipelineBoard = React.lazy(() => import("./pages/PipelineBoard"));
const ExceptionCenter = React.lazy(() => import("./pages/ExceptionCenter"));
const LiveTracking = React.lazy(() => import("./pages/LiveTracking"));
const SuperadminConsole = React.lazy(() => import("./pages/SuperadminConsole"));
const SettingsPage = React.lazy(() => import("./pages/Settings"));
const DriverPortal = React.lazy(() => import("./pages/DriverPortal"));
const CarrierPortal = React.lazy(() => import("./pages/CarrierPortal"));
const BookingPage = React.lazy(() => import("./pages/BookingPage"));
const PrivacyRequest = React.lazy(() => import("./pages/PrivacyRequest"));
const GateCheckinPage = React.lazy(() => import("./pages/GateCheckinPage"));
const GateCheckinStatusPage = React.lazy(() => import("./pages/GateCheckinStatusPage"));
const KioskCheckinPage = React.lazy(() => import("./pages/KioskCheckinPage"));

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <RootRoutes />
      </AuthProvider>
    </I18nProvider>
  );
}

function RootRoutes() {
  return (
    <Routes>
      {/* Public routes — no staff login required */}
      <Route path="/display/:token" element={<Suspense fallback={null}><TVDisplay /></Suspense>} />
      <Route path="/book/:token" element={<Suspense fallback={<PageLoader />}><BookingPage /></Suspense>} />
      <Route path="/driver" element={<Suspense fallback={<PageLoader />}><DriverPortal /></Suspense>} />
      <Route path="/carrier" element={<Suspense fallback={<PageLoader />}><CarrierPortal /></Suspense>} />
      <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><PrivacyRequest /></Suspense>} />
      <Route path="/gate-checkin/status/:token" element={<Suspense fallback={<PageLoader />}><GateCheckinStatusPage /></Suspense>} />
      <Route path="/gate-checkin/:facilityId" element={<Suspense fallback={<PageLoader />}><GateCheckinPage /></Suspense>} />
      <Route path="/kiosk/:facilityId" element={<Suspense fallback={<PageLoader />}><KioskCheckinPage /></Suspense>} />
      <Route path="*" element={<StaffArea />} />
    </Routes>
  );
}

function PageLoader() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

function StaffArea() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-500 animate-pulse">Loading SkyYard...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  const guard = (path: string, element: React.ReactNode) => (canAccess(user.role, path) ? element : <Restricted role={user.role} />);

  return (
    <ToastProvider>
      <AppLayout user={user}>
        <Suspense fallback={<ViewLoader />}>
          <Routes>
            <Route path="/" element={guard("/", <Dashboard />)} />
            <Route path="/network" element={guard("/network", <NetworkDashboard />)} />
            <Route path="/finance" element={guard("/finance", <AccountsReceivable />)} />
            <Route path="/calendar" element={guard("/calendar", <AppointmentCalendar />)} />
            <Route path="/analytics" element={guard("/analytics", <ExecutiveDashboard />)} />
            <Route path="/reports/builder" element={guard("/reports/builder", <ReportBuilder />)} />
            <Route path="/settings/notifications" element={guard("/settings/notifications", <NotificationSettings />)} />
            <Route path="/settings/dock-rules" element={guard("/settings/dock-rules", <DockRules />)} />
            <Route path="/gate" element={guard("/gate", <GateConsole />)} />
            <Route path="/tracking" element={guard("/tracking", <LiveTracking />)} />
            <Route path="/dispatch" element={guard("/dispatch", <DispatchBoard />)} />
            <Route path="/pipeline" element={guard("/pipeline", <PipelineBoard />)} />
            <Route path="/exceptions" element={guard("/exceptions", <ExceptionCenter />)} />
            <Route path="/superadmin" element={guard("/superadmin", <SuperadminConsole />)} />
            <Route path="/settings" element={guard("/settings", <SettingsPage />)} />
            <Route path="/design" element={<DesignSystemExplorer />} />
          </Routes>
        </Suspense>
      </AppLayout>
    </ToastProvider>
  );
}

function Restricted({ role }: { role: string }) {
  return (
    <div className="max-w-md mx-auto mt-20 text-center bg-white border border-slate-200 rounded-3xl p-10">
      <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-5">
        <Lock size={24} />
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">Access restricted</h2>
      <p className="text-sm text-slate-500">
        Your role (<span className="font-semibold text-slate-700">{ROLE_LABELS[role] || role}</span>) doesn't include this section. Ask a facility admin if you need access.
      </p>
    </div>
  );
}

function ViewLoader() {
  return (
    <div className="w-full flex justify-center py-20">
      <div className="w-8 h-8 border-3 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

// --- LAYOUT ---

function AppLayout({ children, user }: any) {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const location = useLocation();
  const { logout } = useAuth();
  const { t } = useI18n();
  const { onlineUsers } = usePresence(user.facility_id || 1, user.name || user.email);

  const allNavItems = [
    { to: "/", icon: <LayoutDashboard size={20} />, label: t("nav.dashboard") },
    { to: "/gate", icon: <ScanLine size={20} />, label: t("nav.gate") },
    { to: "/tracking", icon: <Radar size={20} />, label: "Live Tracking" },
    { to: "/dispatch", icon: <ArrowRightLeft size={20} />, label: t("nav.dispatch") },
    { to: "/pipeline", icon: <ShieldCheck size={20} />, label: "Pipeline" },
    { to: "/exceptions", icon: <ShieldAlert size={20} />, label: "Exceptions" },
    { to: "/network", icon: <Globe size={20} />, label: t("nav.network") },
    { to: "/calendar", icon: <Calendar size={20} />, label: t("nav.calendar") },
    { to: "/finance", icon: <DollarSign size={20} />, label: t("nav.finance") },
    { to: "/analytics", icon: <BarChart3 size={20} />, label: t("nav.analytics") },
    { to: "/superadmin", icon: <ShieldCheck size={20} />, label: t("nav.superadmin") },
    { to: "/design", icon: <Palette size={20} />, label: t("nav.design") },
  ];
  const navItems = allNavItems.filter((item) => canAccess(user.role, item.to));

  return (
    <div className="flex h-screen bg-[var(--background)] overflow-hidden font-sans">
      <CommandPalette />
      {/* Sidebar */}
      <aside className={`
        ${sidebarOpen ? 'w-64' : 'w-20'}
        bg-white border-r border-slate-200 transition-all duration-300 flex flex-col z-50
      `}>
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <Warehouse className="text-indigo-600 w-8 h-8 shrink-0" />
          {sidebarOpen && <span className="ml-3 font-bold text-xl tracking-tight text-slate-900">SkyYard</span>}
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all
                ${location.pathname === item.to
                  ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}
              `}
            >
              <span className="shrink-0">{item.icon}</span>
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </Link>
          ))}

          {sidebarOpen && onlineUsers.length > 0 && (
            <div className="mt-10 px-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Online Now</p>
              <div className="space-y-3">
                {onlineUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black text-white shadow-sm"
                      style={{ background: u.color }}
                    >
                      {u.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                       <p className="text-[11px] font-bold text-slate-700 truncate">{u.name}</p>
                       <p className="text-[9px] font-medium text-slate-400 truncate tracking-tight uppercase">{u.page.split('/').pop() || 'HOME'}</p>
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-1">
          {canAccess(user.role, "/settings") && (
          <Link to="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-50 transition-all">
            <SettingsIcon size={20} />
            {sidebarOpen && <span className="font-medium text-sm">{t("nav.settings")}</span>}
          </Link>
          )}
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 hover:bg-red-50 transition-all">
            <LogOut size={20} />
            {sidebarOpen && <span className="font-medium text-sm">{t("nav.logout")}</span>}
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md xl:hidden">
              <Menu size={20} />
            </button>
            <div className="relative group hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="Search yard (Cmd+K)..."
                className="bg-slate-50 border border-slate-200 rounded-lg py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-64"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <NotificationBell />
            <div className="h-8 w-px bg-slate-200" />
            <div className="flex items-center gap-3">
              <div className="text-right hidden md:block">
                <p className="text-sm font-semibold text-slate-900 leading-tight">{user.name || user.email}</p>
                <p className="text-[11px] text-slate-500 font-medium">{user.role} · Terminal Active</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
                {(user.name || user.email)?.charAt(0)?.toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 bg-[var(--background)] custom-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
}

// --- SCREENS ---

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function Dashboard() {
  const [stats, setStats] = React.useState<any>({});
  const [spots, setSpots] = React.useState<any[]>([]);
  const [attention, setAttention] = React.useState<any[]>([]);

  React.useEffect(() => {
    fetch("/api/yard-status")
      .then(r => r.json())
      .then(data => {
        setStats(data.stats);
        setSpots(data.spots);
      });
    const loadAttention = () => fetch("/api/admin/needs-attention").then(r => r.ok ? r.json() : []).then(setAttention).catch(() => {});
    loadAttention();
    const t = setInterval(loadAttention, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <Reveal preset="fade-up" delay={0}>
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-4xl font-bold text-slate-900 tracking-tight">Overview</h2>
            <p className="text-slate-500 font-medium mt-1">Terminal activities for the current cycle.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/gate" className="bg-white border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all">Gate Console</Link>
            <Link to="/gate" className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100">Add Entry</Link>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Reveal preset="fade-up" delay={100}>
          <StatItem icon={<Truck />} label="In-Yard" value={stats.totalTrailers ?? stats.active_trailers ?? 0} sub="+2 from last hour" color="indigo" />
        </Reveal>
        <Reveal preset="fade-up" delay={150}>
          <StatItem icon={<DoorOpen />} label="Available Docks" value={spots.filter((s:any) => s.type === 'DOCK' && s.status === 'EMPTY').length} sub="Ready for arrivals" color="teal" />
        </Reveal>
        <Reveal preset="fade-up" delay={200}>
          <StatItem icon={<Clock />} label="Avg. Dwell" value={42} suffix="m" sub="On target" color="amber" />
        </Reveal>
        <Reveal preset="fade-up" delay={250}>
          <StatItem icon={<Activity />} label="Daily Velocity" value={128} sub="Units processed" color="indigo" />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Reveal preset="fade-up" delay={300} className="lg:col-span-2 shadow-spatial">
          <div className="bg-white border border-slate-200 rounded-[2rem] p-8">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-bold text-slate-900 text-lg">Yard Status Map</h3>
              <div className="flex gap-6">
                <Legend label="Occupied" color="bg-indigo-500" />
                <Legend label="Available" color="bg-slate-200" />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {spots.map((spot: any) => (
                <div
                  key={spot.id}
                  className={`w-14 h-12 rounded-xl border flex items-center justify-center text-[10px] font-bold transition-all shadow-sm ${
                    (spot.status === 'OCCUPIED' || spot.plate)
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-slate-50 border-slate-100 text-slate-400'
                  }`}
                >
                  {spot.name}
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal preset="fade-up" delay={350}>
          <div className="bg-white border border-slate-200 rounded-[2rem] p-8 divide-y divide-slate-100 shadow-spatial">
            <h3 className="font-bold text-slate-900 text-lg pb-6 flex items-center justify-between">
              Needs Attention
              {attention.length > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{attention.length}</span>}
            </h3>
            <div className="py-4 space-y-5 max-h-72 overflow-y-auto">
              {attention.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Nothing needs attention right now.</p>}
              {attention.slice(0, 8).map((a, i) => (
                <Link key={i} to={a.link} className="block">
                  <AlertItem severity={a.severity} msg={`${a.title} — ${a.description}`} time={timeAgo(a.timestamp)} />
                </Link>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function StatItem({ icon, label, value, suffix = "", sub, color }: any) {
  const tilt = use3DTilt(5);
  const colors: any = {
    indigo: 'bg-indigo-50 text-indigo-600',
    teal: 'bg-teal-50 text-teal-600',
    amber: 'bg-amber-50 text-amber-600'
  };
  return (
    <div
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="bg-white border border-slate-200 p-8 rounded-[2rem] shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col gap-4 group"
      style={{ transformStyle: "preserve-3d" }}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${colors[color]} group-hover:scale-110 transition-transform`} style={{ transform: "translateZ(20px)" }}>
        {React.cloneElement(icon, { size: 24 })}
      </div>
      <div style={{ transform: "translateZ(10px)" }}>
        <h4 className="text-4xl font-bold text-slate-900 tracking-tight">
          <CountUp value={value} />{suffix}
        </h4>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">{label}</p>
      </div>
      <p className="text-[11px] font-semibold text-slate-400 mt-2">{sub}</p>
    </div>
  );
}

function AlertItem({ severity, msg, time }: any) {
  return (
    <div className="flex gap-4 group cursor-pointer">
      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
        severity === 'error' ? 'bg-red-500' :
        severity === 'warning' ? 'bg-amber-500' : 'bg-indigo-500'
      }`} />
      <div className="space-y-0.5">
        <p className="text-sm font-bold text-slate-800 leading-tight group-hover:text-indigo-600 transition-colors">{msg}</p>
        <p className="text-[11px] font-medium text-slate-400">{time}</p>
      </div>
    </div>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}

function DesignSystemExplorer() {
  const colors = [
    { name: "Teal", var: "oklch(0.72 0.15 185)" },
    { name: "Blue", var: "oklch(0.60 0.18 250)" },
    { name: "Amber", var: "oklch(0.78 0.18 80)" },
    { name: "Red", var: "oklch(0.55 0.22 30)" },
    { name: "Green", var: "oklch(0.70 0.17 145)" },
  ];

  return (
    <div className="space-y-12 max-w-5xl mx-auto py-12">
      <Reveal preset="fade-up">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tighter">SkyYard <span className="text-indigo-600">Design System</span></h1>
          <p className="text-xl text-slate-500 max-w-2xl">Perceptually uniform colors using oklch(), spatial depth, and cinematic motion.</p>
        </div>
      </Reveal>

      <section className="space-y-6">
        <h3 className="text-2xl font-bold">Spatial Colors (oklch)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-6">
          {colors.map(c => (
            <div key={c.name} className="space-y-3">
              <div className="h-32 w-full rounded-2xl shadow-lg transition-transform hover:scale-105" style={{ background: c.var }} />
              <div>
                <p className="font-bold text-slate-900">{c.name}</p>
                <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">{c.var}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <h3 className="text-2xl font-bold">Typography Specimens</h3>
        <div className="bg-white p-12 rounded-[2rem] border border-slate-100 space-y-8 shadow-sm">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Display Bold / 72px</p>
            <h1 className="text-6xl font-bold tracking-tight">Main Terminal Hub</h1>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Heading / 32px</p>
            <h2 className="text-3xl font-bold">Real-time Network Sync</h2>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mono / 14px</p>
            <p className="font-mono text-sm text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-100">
              TRUCK_ID: AB-1234-XYZ | STATUS: PROCESSING_IN_GATE
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-6 pb-20">
        <h3 className="text-2xl font-bold">Motion Presets</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="p-8 bg-white border border-slate-100 rounded-3xl group">
             <div className="motion-fade-up">
                <h4 className="font-bold text-lg mb-2">.motion-fade-up</h4>
                <p className="text-sm text-slate-500">Smooth translateZ + opacity reveal.</p>
             </div>
          </div>
          <div className="p-8 bg-white border border-slate-100 rounded-3xl">
             <div className="motion-spring-pop">
                <h4 className="font-bold text-lg mb-2">.motion-spring-pop</h4>
                <p className="text-sm text-slate-500">Elastic scaling for important alerts.</p>
             </div>
          </div>
        </div>
      </section>
    </div>
  );
}
