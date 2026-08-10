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
  HardHat,
  FileText,
  AlertTriangle,
  Users,
  Percent,
  MapPin,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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
// mapbox-gl is large — lazy-loaded so it only ships to users who load a
// page with a map, not folded into the main entry chunk every page pays for.
const YardMap = React.lazy(() => import("./components/YardMap"));
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
const SafetyCenter = React.lazy(() => import("./pages/SafetyCenter"));
const DocumentCenter = React.lazy(() => import("./pages/DocumentCenter"));
const LiveTracking = React.lazy(() => import("./pages/LiveTracking"));
const SuperadminConsole = React.lazy(() => import("./pages/SuperadminConsole"));
const SettingsPage = React.lazy(() => import("./pages/Settings"));
const DriverPortal = React.lazy(() => import("./pages/DriverPortal"));
const CarrierPortal = React.lazy(() => import("./pages/CarrierPortal"));
const BookingPage = React.lazy(() => import("./pages/BookingPage"));
const CustomerPortal = React.lazy(() => import("./pages/CustomerPortal"));
const DriverDetail = React.lazy(() => import("./pages/DriverDetail"));
const CarrierDetail = React.lazy(() => import("./pages/CarrierDetail"));
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
      <Route path="/customer/:token" element={<Suspense fallback={<PageLoader />}><CustomerPortal /></Suspense>} />
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
            <Route path="/drivers/:id" element={guard("/gate", <Suspense fallback={<PageLoader />}><DriverDetail /></Suspense>)} />
            <Route path="/carriers/:id" element={guard("/network", <Suspense fallback={<PageLoader />}><CarrierDetail /></Suspense>)} />
            <Route path="/tracking" element={guard("/tracking", <LiveTracking />)} />
            <Route path="/dispatch" element={guard("/dispatch", <DispatchBoard />)} />
            <Route path="/pipeline" element={guard("/pipeline", <PipelineBoard />)} />
            <Route path="/exceptions" element={guard("/exceptions", <ExceptionCenter />)} />
            <Route path="/safety" element={guard("/safety", <SafetyCenter />)} />
            <Route path="/documents" element={guard("/documents", <DocumentCenter />)} />
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
    { to: "/safety", icon: <HardHat size={20} />, label: "Safety" },
    { to: "/documents", icon: <FileText size={20} />, label: "Documents" },
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
        bg-[var(--surface-container-low)] border-r border-[var(--outline-variant)]/20 transition-[width] duration-300 flex flex-col z-50
      `}>
        <div className="h-16 flex items-center px-6">
          <Warehouse className="text-[var(--primary)] w-8 h-8 shrink-0" />
          {sidebarOpen && <span className="ml-3 font-extrabold text-xl tracking-tight text-[var(--primary)]" style={{ fontFamily: "var(--font-heading)" }}>SkyYard</span>}
        </div>

        <nav className="flex-1 mt-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`
                flex items-center gap-3 px-3 py-3 rounded-sm transition-all duration-150
                ${location.pathname === item.to
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]'}
              `}
            >
              <span className="shrink-0">{item.icon}</span>
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </Link>
          ))}

          {sidebarOpen && onlineUsers.length > 0 && (
            <div className="mt-10 px-3">
              <p className="text-[10px] font-bold text-[var(--on-surface-variant)] uppercase tracking-widest mb-4">Online Now</p>
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
                       <p className="text-[11px] font-bold text-[var(--on-surface)] truncate">{u.name}</p>
                       <p className="text-[9px] font-medium text-[var(--on-surface-variant)] truncate tracking-tight uppercase">{u.page.split('/').pop() || 'HOME'}</p>
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--secondary)] animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-[var(--outline-variant)]/20 flex items-center gap-3">
          {canAccess(user.role, "/settings") && (
          <Link to="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-sm text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] transition-all">
            <SettingsIcon size={18} />
            {sidebarOpen && <span className="font-medium text-sm">{t("nav.settings")}</span>}
          </Link>
          )}
        </div>
        {sidebarOpen && (
          <div className="px-4 pb-4">
            <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-[var(--error)] hover:bg-[var(--error-container)]/40 transition-all">
              <LogOut size={18} />
              <span className="font-medium text-sm">{t("nav.logout")}</span>
            </button>
          </div>
        )}
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-[var(--surface-container-lowest)] border-b border-[var(--outline-variant)]/20 flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 text-[var(--on-surface-variant)] hover:text-[var(--primary)] hover:bg-[var(--surface-container-low)] rounded-sm xl:hidden">
              <Menu size={20} />
            </button>
            <div className="relative group hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--on-surface-variant)]" />
              <input
                placeholder="Search yard (Cmd+K)..."
                readOnly
                onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
                className="bg-[var(--surface-container-low)] border-none text-[var(--on-surface)] placeholder:text-[var(--outline)]/70 rounded-sm py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary)] transition-all w-64 cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <NotificationBell />
            <div className="h-8 w-px bg-[var(--outline-variant)]/30" />
            <div className="flex items-center gap-3">
              <div className="text-right hidden md:block">
                <p className="text-sm font-semibold text-[var(--on-surface)] leading-tight">{user.name || user.email}</p>
                <p className="text-[11px] text-[var(--on-surface-variant)] font-medium">{user.role} · Terminal Active</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-[var(--surface-container-high)] flex items-center justify-center text-[var(--on-surface)] font-bold text-sm border border-[var(--outline-variant)]">
                {(user.name || user.email)?.charAt(0)?.toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 bg-[var(--background)] custom-scrollbar">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
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
  const [attention, setAttention] = React.useState<any>({ critical: [], timeCritical: [], operations: [], upcoming: [] });
  const [avgDwellMinutes, setAvgDwellMinutes] = React.useState<number | null>(null);
  const [dailyVelocity, setDailyVelocity] = React.useState(0);
  const [today, setToday] = React.useState<{ expectedArrivals: number; noShows: number; activeMoves: number; hostlersAvailable: number; hostlersBusy: number; arrivalsNext60m: number; gateQueue: number; departuresImminent: number; criticalExceptions: number }>({ expectedArrivals: 0, noShows: 0, activeMoves: 0, hostlersAvailable: 0, hostlersBusy: 0, arrivalsNext60m: 0, gateQueue: 0, departuresImminent: 0, criticalExceptions: 0 });
  const [zones, setZones] = React.useState<{ zone: string; total: number; occupied: number }[]>([]);
  const [unresolvedSafetySpotIds, setUnresolvedSafetySpotIds] = React.useState<number[]>([]);
  const [spotsWithOpenExceptions, setSpotsWithOpenExceptions] = React.useState<number[]>([]);
  const [equipment, setEquipment] = React.useState({ down: 0, total: 0 });
  const [unmanagedTrailers, setUnmanagedTrailers] = React.useState<{ spotId: number; spotName: string; plate: string; dwellHours: number }[]>([]);
  const [arrivalsAtRisk, setArrivalsAtRisk] = React.useState<any[]>([]);
  const [detentionRisk, setDetentionRisk] = React.useState<any[]>([]);
  const [facility, setFacility] = React.useState<any>(null);
  const [selectedSpot, setSelectedSpot] = React.useState<any>(null);

  React.useEffect(() => {
    fetch("/api/yard-status")
      .then(r => r.json())
      .then(data => {
        setStats(data.stats);
        setSpots(data.spots);
        setAvgDwellMinutes(data.avgDwellMinutes);
        setDailyVelocity(data.dailyVelocity ?? 0);
        setToday(data.today || { expectedArrivals: 0, noShows: 0, activeMoves: 0, hostlersAvailable: 0, hostlersBusy: 0, arrivalsNext60m: 0, gateQueue: 0, departuresImminent: 0, criticalExceptions: 0 });
        setZones(data.zones || []);
        setUnresolvedSafetySpotIds(data.unresolvedSafetySpotIds || []);
        setSpotsWithOpenExceptions(data.spotsWithOpenExceptions || []);
        setEquipment({ down: data.equipmentDown || 0, total: data.equipmentTotal || 0 });
        setUnmanagedTrailers(data.unmanagedTrailers || []);
        setFacility(data.facility || null);
      });
    fetch("/api/admin/arrivals-eta").then(r => r.ok ? r.json() : null)
      .then(d => setArrivalsAtRisk((d?.arrivals || []).filter((a: any) => a.risk === "AT_RISK" || a.risk === "LATE")))
      .catch(() => {});
    fetch("/api/admin/detention-risk").then(r => r.ok ? r.json() : []).then(setDetentionRisk).catch(() => {});
    const loadAttention = () => fetch("/api/admin/needs-attention").then(r => r.ok ? r.json() : { critical: [], timeCritical: [], operations: [], upcoming: [] }).then(setAttention).catch(() => {});
    loadAttention();
    const t = setInterval(loadAttention, 60000);
    return () => clearInterval(t);
  }, []);

  const actionCenterTotal = (attention.critical?.length || 0) + (attention.timeCritical?.length || 0) + (attention.operations?.length || 0) + (attention.upcoming?.length || 0);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <Reveal preset="fade-up" delay={0}>
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-4xl font-extrabold text-[var(--on-surface)] tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>Overview</h2>
            <p className="text-[var(--on-surface-variant)] font-medium mt-1">Terminal activities for the current cycle.</p>
          </div>
          <div className="flex gap-3">
            <Link to="/gate" className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)] text-[var(--on-surface-variant)] px-4 py-2.5 rounded-sm text-sm font-bold hover:bg-[var(--surface-container-low)] transition-all">Gate Console</Link>
            <Link to="/gate" className="bg-[var(--primary)] text-[var(--primary-foreground)] px-5 py-2.5 rounded-sm text-sm font-bold hover:bg-[var(--primary-container)] active:scale-[0.98] transition-all shadow-sm">Add Entry</Link>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Reveal preset="fade-up" delay={100}>
          <StatItem icon={<Truck />} label="In-Yard" value={stats.totalTrailers ?? stats.active_trailers ?? 0} sub="Currently on site" color="indigo" to="/tracking" />
        </Reveal>
        <Reveal preset="fade-up" delay={150}>
          <StatItem icon={<DoorOpen />} label="Available Docks" value={spots.filter((s:any) => s.type === 'DOCK' && s.status === 'EMPTY').length} sub="Ready for arrivals" color="teal" to="/dispatch" />
        </Reveal>
        <Reveal preset="fade-up" delay={200}>
          <StatItem icon={<Clock />} label="Avg. Dwell" value={avgDwellMinutes ?? "—"} suffix={avgDwellMinutes != null ? "m" : ""} sub={avgDwellMinutes != null ? "Today's departures" : "No departures yet today"} color="amber" to="/tracking" />
        </Reveal>
        <Reveal preset="fade-up" delay={250}>
          <StatItem icon={<Activity />} label="Daily Velocity" value={dailyVelocity} sub="Departed today" color="indigo" to="/analytics" />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Reveal preset="fade-up" delay={275}>
          <StatItem icon={<Calendar />} label="Expected Arrivals Today" value={today.expectedArrivals} sub="Scheduled, not yet checked in" color="indigo" to="/calendar" />
        </Reveal>
        <Reveal preset="fade-up" delay={300}>
          <StatItem icon={<AlertTriangle />} label="No-Shows Today" value={today.noShows} sub="Missed their grace period" color="amber" to="/calendar" />
        </Reveal>
        <Reveal preset="fade-up" delay={325}>
          <StatItem icon={<ArrowRightLeft />} label="Active Moves" value={today.activeMoves} sub="In the dispatch queue" color="indigo" to="/dispatch" />
        </Reveal>
        <Reveal preset="fade-up" delay={350}>
          <StatItem icon={<Users />} label="Hostlers Available" value={today.hostlersAvailable} sub={`${today.hostlersBusy} busy right now`} color="teal" to="/dispatch" />
        </Reveal>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Live Yard Status — Next 60 Minutes</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          <Reveal preset="fade-up" delay={375}>
            <StatItem icon={<DoorOpen />} label="Gate Queue" value={today.gateQueue} sub="Waiting for approval" color={today.gateQueue > 0 ? "amber" : "teal"} to="/gate" />
          </Reveal>
          <Reveal preset="fade-up" delay={400}>
            <StatItem icon={<Percent />} label="Dock Utilization" value={spots.filter((s: any) => s.type === "DOCK").length ? Math.round((spots.filter((s: any) => s.type === "DOCK" && s.status === "OCCUPIED").length / spots.filter((s: any) => s.type === "DOCK").length) * 100) : 0} suffix="%" sub="Docks occupied" color="indigo" to="/dispatch" />
          </Reveal>
          <Reveal preset="fade-up" delay={425}>
            <StatItem icon={<Calendar />} label="Arrivals Next 60m" value={today.arrivalsNext60m} sub="Scheduled to arrive soon" color="indigo" to="/calendar" />
          </Reveal>
          <Reveal preset="fade-up" delay={450}>
            <StatItem icon={<LogOut />} label="Departures Imminent" value={today.departuresImminent} sub="Out-pass issued, not yet exited" color="teal" to="/gate" />
          </Reveal>
          <Reveal preset="fade-up" delay={475}>
            <StatItem icon={<ShieldAlert />} label="Critical Exceptions" value={today.criticalExceptions} sub="Unresolved right now" color={today.criticalExceptions > 0 ? "amber" : "teal"} to="/exceptions" />
          </Reveal>
        </div>
      </div>

      {facility && (
        <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <MapPin size={14} className="text-indigo-500" /> Facility Map — click a spot for details
            </p>
            {zones.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {zones.map((z) => (
                  <span key={z.zone} className="text-xs font-bold bg-[var(--surface-container-low)] border border-[var(--outline-variant)] text-[var(--on-surface-variant)] rounded-sm px-3 py-1.5">
                    {z.zone}: {z.occupied}/{z.total}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Suspense fallback={<div className="rounded-2xl bg-slate-50 animate-pulse" style={{ height: "440px" }} />}>
            <YardMap
              spots={spots}
              facility={facility}
              unresolvedSafetySpotIds={unresolvedSafetySpotIds}
              spotsWithOpenExceptions={spotsWithOpenExceptions}
              onSelectSpot={(spot: any) => setSelectedSpot(spot)}
              height="440px"
            />
          </Suspense>
        </div>
      )}

      {unmanagedTrailers.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-[1.75rem] p-6">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} /> Unmanaged Trailers — sitting with no active move, not yet flagged
          </p>
          <div className="flex flex-wrap gap-3">
            {unmanagedTrailers.map((t) => (
              <span key={t.spotId} className="text-sm font-bold px-3 py-2 rounded-sm bg-white border border-amber-500/40 text-amber-800">
                {t.plate} <span className="text-amber-500/80 font-medium">· {t.spotName} · {t.dwellHours}h</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {arrivalsAtRisk.length > 0 && (
        <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-6 hover:shadow-md transition-shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" /> Arrivals At Risk — real traffic-aware ETA vs. appointment
          </p>
          <div className="space-y-2">
            {arrivalsAtRisk.map((a) => (
              <div key={a.id} className={`flex items-center justify-between gap-4 rounded-xl px-4 py-3 border ${a.risk === "LATE" ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
                <div className="text-sm">
                  <span className="font-bold text-[var(--on-surface)]">{a.plate}</span>
                  <span className="text-slate-500"> · {a.carrier} · appointment {new Date(a.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <p className="text-xs text-slate-500 mt-0.5">{a.reason}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg ${a.risk === "LATE" ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>{a.risk}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detentionRisk.length > 0 && (
        <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-6 hover:shadow-md transition-shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" /> Detention Risk — real cost projection, not yet accruing
          </p>
          <div className="space-y-2">
            {detentionRisk.map((r) => (
              <div key={r.plate} className="flex items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="text-sm">
                  <span className="font-bold text-[var(--on-surface)]">{r.plate}</span>
                  <span className="text-slate-500"> · {r.dwellMinutes} min dwell so far</span>
                  <p className="text-xs text-slate-500 mt-0.5">{r.reason}</p>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg bg-amber-500 text-white">{r.minutesUntilThreshold}m to threshold</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        <Reveal preset="fade-up" delay={350}>
          <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-8 hover:shadow-md transition-shadow">
            <h3 className="font-bold text-[var(--on-surface)] text-lg pb-6 flex items-center justify-between" style={{ fontFamily: "var(--font-heading)" }}>
              Action Center
              {actionCenterTotal > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-700">{actionCenterTotal}</span>}
            </h3>
            <div className="space-y-6 max-h-[420px] overflow-y-auto pr-1">
              {actionCenterTotal === 0 && <p className="text-sm text-slate-400 text-center py-8">Nothing needs attention right now.</p>}
              {([
                { key: "critical", label: "Critical" },
                { key: "timeCritical", label: "Time critical" },
                { key: "operations", label: "Operations" },
                { key: "upcoming", label: "Upcoming" },
              ] as const).map(({ key, label }) => {
                const list = attention[key] || [];
                if (list.length === 0) return null;
                return (
                  <div key={key} className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label} · {list.length}</p>
                    <div className="space-y-4 divide-y divide-slate-800/60">
                      {list.slice(0, 6).map((a: any, i: number) => (
                        <Link key={i} to={a.action?.link || "/"} className="block pt-4 first:pt-0">
                          <AlertItem severity={a.severity} msg={`${a.title} — ${a.description}`} time={timeAgo(a.timestamp)} actionLabel={a.action?.label} />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>

      {spots.some((s: any) => s.type === "DOCK") && (
        <Reveal preset="fade-up" delay={375}>
          <div className="bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 rounded-sm shadow-sm p-8 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between pb-6">
              <h3 className="font-bold text-[var(--on-surface)] text-lg" style={{ fontFamily: "var(--font-heading)" }}>Dock Board</h3>
              {equipment.total > 0 && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${equipment.down > 0 ? "bg-amber-500/10 text-amber-400" : "bg-teal-500/10 text-teal-400"}`}>
                  Equipment: {equipment.total - equipment.down}/{equipment.total} available
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {spots.filter((s: any) => s.type === "DOCK").map((dock: any) => {
                const cargoColor: Record<string, string> = {
                  loaded: "bg-teal-500/10 text-teal-700 border-teal-500/30",
                  unloaded: "bg-teal-500/10 text-teal-700 border-teal-500/30",
                  completed: "bg-teal-500/10 text-teal-700 border-teal-500/30",
                  short: "bg-red-500/10 text-red-700 border-red-500/30",
                  over: "bg-red-500/10 text-red-700 border-red-500/30",
                  damaged: "bg-red-500/10 text-red-700 border-red-500/30",
                  rejected: "bg-red-500/10 text-red-700 border-red-500/30",
                };
                return (
                <button
                  type="button"
                  key={dock.id}
                  onClick={() => dock.plate && setSelectedSpot(dock)}
                  className={`text-left rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 ${dock.plate ? "bg-indigo-500/10 border-indigo-500/30 hover:border-indigo-400/50 cursor-pointer" : "bg-[var(--surface-container-low)] border-[var(--outline-variant)]/30 cursor-default"}`}
                >
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{dock.name}</p>
                  {dock.plate ? (
                    <>
                      <p className="font-bold text-[var(--on-surface)] mt-1">{dock.plate}</p>
                      <span className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cargoColor[dock.cargo_status] || "bg-[var(--surface-container-high)] text-[var(--on-surface)] border-[var(--outline-variant)]"}`}>
                        {dock.cargo_status || "expected"}
                      </span>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--on-surface-variant)] mt-1 flex items-center gap-1.5"><DoorOpen size={14} className="text-[var(--outline)]" /> Empty</p>
                  )}
                </button>
                );
              })}
            </div>
          </div>
        </Reveal>
      )}

      <AnimatePresence>
        {selectedSpot && (
          <motion.div
            className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSelectedSpot(null)}
          >
            <motion.div
              className="bg-white border-l border-[var(--outline-variant)]/30 p-8 max-w-md w-full h-full shadow-2xl overflow-y-auto custom-scrollbar"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{selectedSpot.name} · {selectedSpot.type === "DOCK" ? "Dock" : "Parking"}</p>
                  <h3 className="font-bold text-lg text-[var(--on-surface)]" style={{ fontFamily: "var(--font-heading)" }}>{selectedSpot.plate || "Empty spot"}</h3>
                </div>
                <button onClick={() => setSelectedSpot(null)} className="text-[var(--on-surface-variant)] hover:text-black transition-colors">
                  <X size={18} />
                </button>
              </div>
              {selectedSpot.plate ? (
                <div className="space-y-2 text-sm">
                  <DetailRow label="Carrier" value={selectedSpot.carrier} />
                  <DetailRow label="Zone" value={selectedSpot.zone_name} />
                  <DetailRow label="Equipment" value={selectedSpot.equipment_type || "standard"} />
                  <DetailRow label="Cargo status" value={selectedSpot.cargo_status || "expected"} />
                  <DetailRow label="Seal" value={selectedSpot.seal_number} />
                  <DetailRow label="PO number" value={selectedSpot.po_number} />
                  <DetailRow label="Cargo / SKU" value={selectedSpot.sku_summary} />
                  <DetailRow label="Hazmat class" value={selectedSpot.hazmat_class} />
                  <DetailRow label="Tare weight" value={selectedSpot.tare_weight_kg ? `${selectedSpot.tare_weight_kg} kg` : undefined} />
                  {(selectedSpot.checked_in_at || selectedSpot.check_in_time) && (
                    <DetailRow label="On site since" value={timeAgo(selectedSpot.checked_in_at || selectedSpot.check_in_time)} />
                  )}
                  {(() => {
                    const risk = detentionRisk.find((r: any) => r.plate === selectedSpot.plate);
                    return risk ? (
                      <div className="mt-3 pt-3 border-t border-[var(--outline-variant)]/30">
                        <DetailRow label="Detention risk" value={risk.reason} />
                        <DetailRow label="Time to threshold" value={`${risk.minutesUntilThreshold}m`} />
                      </div>
                    ) : null;
                  })()}
                  <div className="pt-4">
                    <Link to="/tracking" onClick={() => setSelectedSpot(null)} className="block text-center bg-[var(--primary)] text-[var(--primary-foreground)] rounded-sm py-2.5 text-xs font-bold hover:bg-[var(--primary-container)] transition-all">
                      Open in Live Tracking
                    </Link>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--on-surface-variant)]">This spot is currently empty.</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--outline-variant)]/10 last:border-0">
      <span className="text-[var(--on-surface-variant)]">{label}</span>
      <span className="font-semibold text-[var(--on-surface)] text-right">{value}</span>
    </div>
  );
}

function StatItem({ icon, label, value, suffix = "", sub, color, to }: any) {
  const tilt = use3DTilt(5);
  // Mapped to the Stitch reference's metric-card language: colored
  // left border + a matching soft icon chip, not a full-tint card.
  const colors: any = {
    indigo: { border: "border-l-[var(--primary)]", chip: "bg-[var(--surface-container-high)] text-[var(--on-surface)]" },
    teal: { border: "border-l-[var(--secondary)]", chip: "bg-[var(--secondary-container)] text-[var(--on-secondary-container)]" },
    amber: { border: "border-l-[#c76c00]", chip: "bg-[var(--tertiary-fixed)] text-[var(--on-tertiary-fixed-variant)]" },
  };
  const c = colors[color] || colors.indigo;
  // Command Center spec: "each KPI must be clickable" — drills into the
  // page that actually explains the number, instead of a dead-end card.
  const Wrapper: any = to ? Link : "div";
  const wrapperProps = to ? { to } : {};
  return (
    <Wrapper
      {...wrapperProps}
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className={`bg-[var(--surface-container-lowest)] border border-[var(--outline-variant)]/20 border-l-4 ${c.border} p-6 rounded-sm shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-3 group ${to ? "cursor-pointer" : ""}`}
      style={{ transformStyle: "preserve-3d" }}
    >
      <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${c.chip} group-hover:scale-105 transition-transform`} style={{ transform: "translateZ(20px)" }}>
        {React.cloneElement(icon, { size: 20 })}
      </div>
      <div style={{ transform: "translateZ(10px)" }}>
        <h4 className="text-4xl font-extrabold text-[var(--on-surface)] tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
          {typeof value === "number" ? <><CountUp value={value} />{suffix}</> : value}
        </h4>
        <p className="text-[10px] font-bold text-[var(--on-surface-variant)] uppercase tracking-widest mt-2">{label}</p>
      </div>
      <p className="text-[11px] font-semibold text-[var(--on-surface-variant)]">{sub}</p>
    </Wrapper>
  );
}

function AlertItem({ severity, msg, time, actionLabel }: any) {
  return (
    <div className="flex gap-4 group cursor-pointer items-start">
      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
        severity === 'critical' || severity === 'error' ? 'bg-red-500' :
        severity === 'warning' ? 'bg-amber-500' : 'bg-indigo-400'
      }`} />
      <div className="space-y-0.5 flex-1 min-w-0">
        <p className="text-sm font-bold text-[var(--on-surface)] leading-tight group-hover:text-indigo-700 transition-colors">{msg}</p>
        <p className="text-[11px] font-medium text-slate-500">{time}</p>
      </div>
      {actionLabel && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-white bg-black group-hover:bg-indigo-700 border border-transparent rounded-sm px-2 py-1 transition-colors">{actionLabel}</span>
      )}
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
