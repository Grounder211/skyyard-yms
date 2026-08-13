import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  format, addDays, startOfWeek, endOfWeek, addWeeks, subWeeks, 
  isSameDay, addMonths, subMonths, startOfMonth, endOfMonth, 
  eachDayOfInterval, startOfDay, endOfDay, addHours, parseISO,
  isToday, isSameMonth
} from "date-fns";
import { 
  ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon,
  Filter, Plus, MoreHorizontal, Maximize2, Trash2,
  CheckCircle2, AlertCircle, Search, LayoutGrid, List,
  ArrowRight, MessageSquareText, Menu
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { io } from "socket.io-client";
import { DndContext, useDroppable, useDraggable, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useToast } from "../contexts/ToastContext";
import VehicleLog from "./VehicleLog";
import BookingRequestsSidebar from "./BookingRequestsSidebar";
import BookingAssignPopover from "./BookingAssignPopover";

type ViewType = "day" | "week" | "month" | "list";

const HEALTH_STYLES: Record<string, string> = {
  ON_TRACK: "bg-teal-100 text-teal-700",
  AT_RISK: "bg-amber-100 text-amber-700",
  LATE: "bg-rose-100 text-rose-700",
  NO_SHOW: "bg-rose-100 text-rose-700",
  BLOCKED: "bg-red-200 text-red-800",
};

export default function AppointmentCalendar() {
  const [view, setView] = useState<ViewType>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<any>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingDrop, setPendingDrop] = useState<{
    mode: "assign" | "reschedule"; plate: string; loadType: string;
    requestId?: number; appointmentId?: number; dropTime: string; position: { x: number; y: number };
  } | null>(null);
  const { toast } = useToast();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, activatorEvent } = event;
    if (!over) return;
    const dropData = over.data.current as { day: Date; hour: number } | undefined;
    if (!dropData) return;
    const dropTime = new Date(dropData.day);
    dropTime.setHours(dropData.hour, 0, 0, 0);

    const dragData = active.data.current as { type: "request"; request: any } | { type: "appointment"; appointment: any };
    const clientEvent = activatorEvent as MouseEvent;
    const position = { x: clientEvent?.clientX ?? 400, y: clientEvent?.clientY ?? 300 };

    if (dragData.type === "request") {
      setPendingDrop({ mode: "assign", plate: dragData.request.plate, loadType: dragData.request.load_type, requestId: dragData.request.id, dropTime: dropTime.toISOString(), position });
    } else {
      setPendingDrop({ mode: "reschedule", plate: dragData.appointment.plate, loadType: dragData.appointment.load_type, appointmentId: dragData.appointment.id, dropTime: dropTime.toISOString(), position });
    }
  };

  const socketRef = useRef<any>(null);

  useEffect(() => {
    fetchAppointments();

    socketRef.current = io();
    socketRef.current.on("yard_update", () => {
      fetchAppointments();
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [currentDate, view]);

  const fetchAppointments = async () => {
    try {
      let start, end;
      if (view === "month") {
        start = startOfMonth(currentDate).toISOString();
        end = endOfMonth(currentDate).toISOString();
      } else if (view === "week") {
        start = startOfWeek(currentDate).toISOString();
        end = endOfWeek(currentDate).toISOString();
      } else {
        start = startOfDay(currentDate).toISOString();
        end = endOfDay(currentDate).toISOString();
      }

      const res = await fetch(`/api/appointments?start=${start}&end=${end}`);
      const data = await res.json();
      setAppointments(data);
      setLoading(false);
    } catch (e) {
      console.error("Failed to fetch appointments", e);
    }
  };

  const handleEdit = (appt: any) => {
    setEditingAppointment(appt);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    try {
      const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast("Booking cancelled", "success");
      }
    } catch (e) {
      toast("Cancellation failed", "error");
    }
  };

  const handlePrev = () => {
    if (view === "month") setCurrentDate(subMonths(currentDate, 1));
    else if (view === "week") setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, -1));
  };

  const handleNext = () => {
    if (view === "month") setCurrentDate(addMonths(currentDate, 1));
    else if (view === "week") setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <div className="min-h-full flex flex-col gap-6 max-w-[1600px] mx-auto px-4 lg:px-8 pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
           <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-100">
               <CalendarIcon size={22} />
             </div>
             <h1 className="text-3xl font-black text-slate-900 tracking-tight">Terminal Scheduler</h1>
           </div>
           <p className="text-slate-500 font-medium mt-1 ml-12">Precision arrival orchestration.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center bg-white border border-slate-200 rounded-2xl p-1 shadow-sm mr-2">
            <ViewButton active={view === 'day'} onClick={() => setView('day')} label="Day" />
            <ViewButton active={view === 'week'} onClick={() => setView('week')} label="Week" />
            <ViewButton active={view === 'month'} onClick={() => setView('month')} label="Month" />
            <ViewButton active={view === 'list'} onClick={() => setView('list')} label="List" />
          </div>

          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex-1 md:flex-none bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95"
          >
            <Plus size={20} />
            New Booking
          </button>
        </div>
      </div>

      {/* Toolbar & Navigation */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/50 backdrop-blur-sm border border-slate-200/60 p-4 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4">
           <button 
             onClick={() => setCurrentDate(new Date())}
             className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all uppercase tracking-widest shadow-sm"
           >
             Today
           </button>
           <div className="flex items-center gap-1">
             <NavArrow direction="prev" onClick={handlePrev} />
             <div className="px-4 text-center min-w-[200px]">
               <h2 className="text-lg font-bold text-slate-900">
                 {view === 'day' ? format(currentDate, "MMMM d, yyyy") : 
                  view === 'month' ? format(currentDate, "MMMM yyyy") :
                  `${format(startOfWeek(currentDate), "MMM d")} - ${format(endOfWeek(currentDate), "MMM d, yyyy")}`}
               </h2>
             </div>
             <NavArrow direction="next" onClick={handleNext} />
           </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={16} />
            <input 
              placeholder="Search appointments..."
              className="pl-11 pr-6 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm font-medium w-[240px] focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all shadow-sm"
            />
          </div>
          <button className="p-2.5 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-colors shadow-sm">
            <Filter size={18} />
          </button>
        </div>
      </div>

      {/* Main Calendar Content */}
      <div className="flex gap-6 items-start">
      {(view === "day" || view === "week") && (
        sidebarOpen ? (
          <BookingRequestsSidebar refreshKey={sidebarRefreshKey} onClose={() => setSidebarOpen(false)} />
        ) : (
          <button
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 h-[70vh] w-11 bg-slate-50/50 border border-slate-200 rounded-3xl flex items-start justify-center pt-4 hover:bg-slate-100 transition-colors"
            aria-label="Show booking requests"
          >
            <Menu size={18} className="text-slate-500" />
          </button>
        )
      )}
      <div className="h-[70vh] shrink-0 flex-1 bg-white border border-slate-200 rounded-[2.5rem] shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-300">
            <div className="w-12 h-12 border-4 border-indigo-600/10 border-t-indigo-600 rounded-full animate-spin" />
            <p className="font-bold uppercase tracking-widest text-[10px]">Syncing Timeline...</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto custom-scrollbar">
            {view === 'month' && <MonthView currentDate={currentDate} appointments={appointments} onEdit={handleEdit} />}
            {view === 'week' && <WeekView currentDate={currentDate} appointments={appointments} hours={hours} onEdit={handleEdit} onDelete={handleDelete} />}
            {view === 'day' && <DayView currentDate={currentDate} appointments={appointments} hours={hours} onEdit={handleEdit} onDelete={handleDelete} />}
            {view === 'list' && <ListView appointments={appointments} onEdit={handleEdit} onDelete={handleDelete} />}
          </div>
        )}
      </div>
      </div>

      <VehicleLog />

      {/* Add Appointment Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <CreateAppointmentModal
            onClose={() => { setIsModalOpen(false); setEditingAppointment(null); }}
            onSuccess={() => { fetchAppointments(); setIsModalOpen(false); setEditingAppointment(null); }}
            initialDate={currentDate}
            editingAppointment={editingAppointment}
          />
        )}
      </AnimatePresence>

      {pendingDrop && (
        <BookingAssignPopover
          mode={pendingDrop.mode}
          plate={pendingDrop.plate}
          loadType={pendingDrop.loadType}
          requestId={pendingDrop.requestId}
          appointmentId={pendingDrop.appointmentId}
          dropTime={pendingDrop.dropTime}
          position={pendingDrop.position}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => {
            setPendingDrop(null);
            setSidebarRefreshKey((k) => k + 1);
            fetchAppointments();
          }}
        />
      )}
    </div>
    </DndContext>
  );
}

function ViewButton({ active, onClick, label }: any) {
  return (
    <button 
      onClick={onClick}
      className={`px-6 py-2 rounded-xl text-xs font-black transition-all uppercase tracking-tight ${active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-900'}`}
    >
      {label}
    </button>
  );
}

function NavArrow({ direction, onClick }: any) {
  return (
    <button onClick={onClick} className="p-2.5 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-900">
      {direction === 'prev' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );
}

// --- View Components ---

function ActionMenu({ appt, onEdit, onDelete }: any) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2.5 rounded-xl hover:bg-white hover:shadow-md transition-all text-slate-400 hover:text-slate-900 group"
      >
        <MoreHorizontal size={18} className={isOpen ? 'text-indigo-600' : ''} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 p-2 z-50 overflow-hidden"
            >
              <button 
                onClick={() => { onEdit(appt); setIsOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all"
              >
                <Maximize2 size={16} />
                Edit Booking
              </button>
              <button 
                onClick={() => { onDelete(appt.id); setIsOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
              >
                <Trash2 size={16} />
                Cancel Slot
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MonthView({ currentDate, appointments, onEdit }: any) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  return (
    <div className="grid grid-cols-7 h-full border-b border-slate-100">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
        <div key={day} className="p-4 text-center border-b border-slate-100 bg-slate-50/50">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{day}</span>
        </div>
      ))}
      {calendarDays.map((day, i) => {
        const dayAppts = appointments.filter((a: any) => isSameDay(parseISO(a.start_time), day));
        const isCurrentMonth = isSameMonth(day, currentDate);

        return (
          <div 
            key={day.toISOString()} 
            className={`min-h-[140px] border-r border-b border-slate-100 p-3 transition-colors hover:bg-slate-50/30 ${!isCurrentMonth ? 'bg-slate-50/20' : ''}`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className={`text-sm font-black ${isToday(day) ? 'w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-100' : isCurrentMonth ? 'text-slate-900' : 'text-slate-300'}`}>
                {format(day, "d")}
              </span>
              {dayAppts.length > 0 && (
                <span className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                  {dayAppts.length} Bookings
                </span>
              )}
            </div>
            <div className="space-y-1.5 overflow-hidden max-h-[100px]">
               {dayAppts.slice(0, 3).map((appt: any) => (
                 <div key={appt.id} className="p-1 px-2 bg-slate-50 border border-slate-100 rounded-lg flex items-center gap-2 group cursor-pointer hover:border-indigo-300 transition-all">
                    <div className={`w-1 h-1 rounded-full ${appt.priority_level === 1 ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                    <span className="text-[10px] font-bold text-slate-700 truncate">{appt.plate}</span>
                 </div>
               ))}
               {dayAppts.length > 3 && (
                 <p className="text-[9px] font-bold text-slate-400 text-center uppercase tracking-widest mt-1">+{dayAppts.length - 3} more</p>
               )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ponytail: this repo has no @types/react installed, so JSX's normal "key
// isn't a real prop" exclusion doesn't apply to strictly-typed components —
// any typed component used with key={} in a .map() hits TS2322. Declaring
// key here (out of the component's real prop type) satisfies tsc without
// loosening it. Real fix: add @types/react + @types/react-dom repo-wide.
function DraggableAppointmentBlock({ appt, children, className = "", style }: { appt: any; children: React.ReactNode; className?: string; style?: React.CSSProperties; key?: React.Key }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `appt-${appt.id}`, data: { type: "appointment", appointment: appt } });
  const dragStyle: React.CSSProperties = { ...style, ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}) };
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`touch-none ${className} ${isDragging ? "opacity-50 z-50" : ""}`} style={dragStyle}>
      {children}
    </div>
  );
}

function DroppableHourCell({ day, hour }: { day: Date; hour: number; key?: React.Key }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day.toISOString()}_${hour}`, data: { day, hour } });
  return (
    <div ref={setNodeRef} className={`h-20 border-b border-slate-50 relative group transition-colors ${isOver ? "bg-indigo-100" : ""}`}>
      <div className="absolute inset-0 bg-indigo-50/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center pointer-events-none">
        <Plus size={16} className="text-indigo-400" />
      </div>
    </div>
  );
}

function WeekView({ currentDate, appointments, hours, onEdit, onDelete }: any) {
  const start = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="flex h-full min-w-[1000px]">
      {/* Time Column */}
      <div className="w-20 border-r border-slate-100 bg-slate-50/30">
        <div className="h-16 border-b border-slate-100" />
        {hours.map((hour: number) => (
          <div key={hour} className="h-20 border-b border-slate-100 flex items-center justify-center">
            <span className="text-[10px] font-black text-slate-400 uppercase">{format(new Date().setHours(hour, 0), "ha")}</span>
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="flex-1 grid grid-cols-7">
        {days.map(day => (
          <div key={day.toISOString()} className="border-r border-slate-100">
            {/* Day Header */}
            <div className={`h-16 border-b border-slate-100 p-4 flex flex-col items-center justify-center transition-colors ${isToday(day) ? 'bg-indigo-50/30' : 'bg-slate-50/50'}`}>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none mb-1">{format(day, "eee")}</span>
              <span className={`text-lg font-black ${isToday(day) ? 'text-indigo-600' : 'text-slate-900'}`}>{format(day, "d")}</span>
            </div>
            
            {/* Time Slots */}
            <div className="relative">
              {hours.map((hour: number) => <DroppableHourCell key={hour} day={day} hour={hour} />)}

              {/* Appointments */}
              {appointments
                .filter((a: any) => isSameDay(parseISO(a.start_time), day))
                .map((appt: any) => {
                  const startD = parseISO(appt.start_time);
                  const top = (startD.getHours() * 80) + (startD.getMinutes() / 60) * 80;
                  const height = (appt.actual_duration_minutes / 60) * 80;

                  return (
                    <DraggableAppointmentBlock key={appt.id} appt={appt} className="absolute left-1 right-1 z-10" style={{ top, height, minHeight: 40 }}>
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      onClick={() => onEdit(appt)}
                      className={`relative w-full h-full rounded-2xl p-3 border-l-4 shadow-xl group cursor-pointer hover:brightness-95 transition-all flex flex-col justify-between overflow-hidden ${
                        appt.priority_level === 1
                          ? 'bg-rose-50 border-rose-500 text-rose-900 shadow-rose-100/50'
                          : appt.status === 'CHECKED_IN'
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-emerald-100/50'
                            : 'bg-indigo-50 border-indigo-500 text-indigo-900 shadow-indigo-100/50'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-1">
                        <p className="text-[11px] font-black leading-tight truncate">{appt.plate}</p>
                        <p className="text-[9px] font-bold opacity-50 whitespace-nowrap">{format(startD, "h:mma")}</p>
                      </div>
                      {height > 50 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase truncate opacity-70 tracking-tight">{appt.carrier}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock size={10} className="opacity-40" />
                            <span className="text-[9px] font-bold opacity-40">{appt.actual_duration_minutes}m</span>
                          </div>
                        </div>
                      )}
                    </motion.div>
                    </DraggableAppointmentBlock>
                  );
                })
              }
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DroppableDayRow({ day, hour, children }: { day: Date; hour: number; children: React.ReactNode; key?: React.Key }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day.toISOString()}_${hour}`, data: { day, hour } });
  return (
    <div ref={setNodeRef} className={`flex gap-6 min-h-[96px] border-b border-slate-50 last:border-0 py-4 group transition-colors ${isOver ? "bg-indigo-100" : ""}`}>
      {children}
    </div>
  );
}

function DayView({ currentDate, appointments, hours, onEdit, onDelete }: any) {
  // Same as week but only one day column
  const dayAppts = appointments.filter((a: any) => isSameDay(parseISO(a.start_time), currentDate));

  return (
    <div className="flex h-full">
      <div className="w-24 border-r border-slate-100 bg-slate-50/30">
        <div className="h-16 border-b border-slate-100" />
        {hours.map((hour: number) => (
          <div key={hour} className="h-24 border-b border-slate-100 flex items-center justify-center">
            <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{format(new Date().setHours(hour, 0), "hh:00 a")}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 relative">
        <div className="h-16 border-b border-slate-100 bg-white sticky top-0 z-20 flex items-center px-8 justify-between">
           <div className="flex items-center gap-3">
             <span className="text-2xl font-black text-slate-900">{format(currentDate, "EEEE")}</span>
             <span className="text-lg font-bold text-slate-400">{format(currentDate, "MMMM d")}</span>
           </div>
           <div className="flex gap-2">
              <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-3 py-1 rounded-full uppercase tracking-widest">{dayAppts.length} Load Nodes</span>
           </div>
        </div>
        
        <div className="p-8 space-y-4">
           {hours.map((hour: number) => {
             const hourAppts = dayAppts.filter((a: any) => parseISO(a.start_time).getHours() === hour);
             return (
               <DroppableDayRow key={hour} day={currentDate} hour={hour}>
                 <div className="w-32 flex flex-col pt-1">
                    <span className="text-[10px] font-black text-slate-300 group-hover:text-indigo-400 transition-colors uppercase tracking-[0.2em]">{format(new Date().setHours(hour, 0), "ha")}</span>
                    <div className="w-8 h-0.5 bg-slate-100 mt-2" />
                 </div>
                 <div className="flex-1 flex gap-4 overflow-x-auto pb-2 custom-scrollbar-hidden">
                    {hourAppts.length > 0 ? hourAppts.map((appt: any) => (
                      <DraggableAppointmentBlock key={appt.id} appt={appt}>
                      <div className="min-w-[280px] bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all flex flex-col justify-between">
                         <div className="flex justify-between items-start">
                            <div>
                               <p className="text-lg font-black text-slate-900 leading-none">{appt.plate}</p>
                               <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">{appt.carrier}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full animate-pulse ${appt.priority_level === 1 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                              <ActionMenu appt={appt} onEdit={onEdit} onDelete={onDelete} />
                            </div>
                         </div>
                         {appt.health && (
                           <span title={appt.health_reason} className={`self-start mt-2 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${HEALTH_STYLES[appt.health] || HEALTH_STYLES.ON_TRACK}`}>
                             {appt.health.replace("_", " ")}
                           </span>
                         )}
                         <div className="flex items-center justify-between mt-4 border-t border-slate-50 pt-3">
                            <div className="flex items-center gap-2">
                               <Clock size={12} className="text-slate-400" />
                               <span className="text-xs font-bold text-slate-600">{format(parseISO(appt.start_time), "HH:mm")}</span>
                            </div>
                            <button className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:bg-indigo-50 px-3 py-1 rounded-lg transition-colors">Manifest</button>
                         </div>
                      </div>
                      </DraggableAppointmentBlock>
                    )) : (
                      <div className="flex-1 border-2 border-dashed border-slate-100 rounded-3xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                         <button className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                           <Plus size={14}/> Add Entry
                         </button>
                      </div>
                    )}
                 </div>
               </DroppableDayRow>
             );
           })}
        </div>
      </div>
    </div>
  );
}

function ListView({ appointments, onEdit, onDelete }: any) {
  if (appointments.length === 0) return (
    <div className="flex flex-col items-center justify-center p-20 gap-4 text-slate-300">
      <List size={48} className="opacity-20" />
      <p className="font-bold uppercase tracking-widest text-xs">No entries in this timeline buffer</p>
    </div>
  );

  return (
    <div className="p-8">
       <div className="grid grid-cols-12 gap-4 px-6 border-b border-slate-100 pb-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
          <div className="col-span-1">Priority</div>
          <div className="col-span-2">Arrival Time</div>
          <div className="col-span-3">Trailer/Plate</div>
          <div className="col-span-3">Carrier</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Actions</div>
       </div>
       <div className="divide-y divide-slate-50">
          {appointments.map((appt: any) => (
            <div key={appt.id} className="grid grid-cols-12 gap-4 px-6 py-6 items-center hover:bg-indigo-50/30 transition-colors rounded-2xl group">
               <div className="col-span-1">
                 <div className={`w-2 h-2 rounded-full ${appt.priority_level === 1 ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]' : 'bg-slate-300'}`} />
               </div>
               <div className="col-span-2">
                  <p className="font-black text-slate-900">{format(parseISO(appt.start_time), "HH:mm")}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">{format(parseISO(appt.start_time), "MMM d")}</p>
               </div>
               <div className="col-span-3">
                  <p className="font-black text-slate-900 text-lg uppercase tracking-tight flex items-center gap-1.5">
                    {appt.plate}
                    {appt.special_instructions && (
                      <MessageSquareText size={13} className="text-amber-500 shrink-0" title={appt.special_instructions} />
                    )}
                  </p>
               </div>
               <div className="col-span-3">
                  <p className="text-sm font-bold text-slate-600 uppercase tracking-widest">{appt.carrier}</p>
               </div>
               <div className="col-span-2">
                  <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    appt.status === 'CHECKED_IN' ? 'bg-emerald-100 text-emerald-700' : 
                    appt.status === 'LATE' ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {appt.status}
                  </span>
               </div>
               <div className="col-span-1 text-right">
                  <ActionMenu appt={appt} onEdit={onEdit} onDelete={onDelete} />
               </div>
            </div>
          ))}
       </div>
    </div>
  );
}

function CreateAppointmentModal({ onClose, onSuccess, initialDate, editingAppointment }: any) {
  const [formData, setFormData] = useState({
    plate: editingAppointment?.plate || "",
    carrier: editingAppointment?.carrier || "",
    start_time: editingAppointment?.start_time ? format(parseISO(editingAppointment.start_time), "yyyy-MM-dd'T'HH:mm") : format(initialDate, "yyyy-MM-dd'T'HH:mm"),
    duration_minutes: editingAppointment?.actual_duration_minutes || 60,
    load_type: editingAppointment?.load_type || "LOAD",
    priority_level: editingAppointment?.priority_level || 2,
    status: editingAppointment?.status || "SCHEDULED",
    load_weight_kg: editingAppointment?.load_weight_kg || "",
    temperature_requirement: editingAppointment?.temperature_requirement || "",
    special_instructions: editingAppointment?.special_instructions || "",
    customer_id: editingAppointment?.customer_id || ""
  });
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const [customers, setCustomers] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/admin/customers").then((r) => r.ok ? r.json() : []).then(setCustomers).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const url = editingAppointment ? `/api/appointments/${editingAppointment.id}` : "/api/appointments";
      const method = editingAppointment ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, load_weight_kg: formData.load_weight_kg ? Number(formData.load_weight_kg) : null, customer_id: formData.customer_id ? Number(formData.customer_id) : null })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(editingAppointment ? "Appointment updated" : "Appointment established successfully", "success");
        for (const w of data.capacityWarning || []) toast(w, "warning");
        onSuccess();
      } else {
        toast("Failed to commit booking to ledger", "error");
      }
    } catch (e) {
      toast("Network synchronization failure", "error");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 lg:p-12">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" 
      />
      
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-white/20"
      >
        <div className="p-10">
          <div className="flex justify-between items-start mb-10">
            <div>
               <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none">
                 {editingAppointment ? "Modify Node" : "Schedule Node"}
               </h2>
               <p className="text-slate-500 font-medium mt-2">
                 {editingAppointment ? "Adjust arrival parameters." : "Initialize a new arrival sequence."}
               </p>
            </div>
            <button onClick={onClose} className="p-3 bg-slate-50 text-slate-400 hover:text-slate-900 rounded-2xl transition-all">
              <Plus className="rotate-45" size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Asset ID / Plate</label>
                <input 
                  required
                  placeholder="e.g. TRK-9902"
                  value={formData.plate}
                  onChange={e => setFormData({...formData, plate: e.target.value.toUpperCase()})}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Carrier Network</label>
                <input 
                  required
                  placeholder="e.g. FedEx Logistics"
                  value={formData.carrier}
                  onChange={e => setFormData({...formData, carrier: e.target.value})}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Timestamp Protocol</label>
                <input 
                  type="datetime-local"
                  required
                  value={formData.start_time}
                  onChange={e => setFormData({...formData, start_time: e.target.value})}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Duration Buffer (Min)</label>
                <select 
                  value={formData.duration_minutes}
                  onChange={e => setFormData({...formData, duration_minutes: parseInt(e.target.value)})}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white appearance-none cursor-pointer"
                >
                  <option value={30}>30 Minutes</option>
                  <option value={60}>60 Minutes</option>
                  <option value={90}>90 Minutes</option>
                  <option value={120}>120 Minutes</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Load weight (kg, optional)</label>
                <input
                  type="number"
                  placeholder="e.g. 18000"
                  value={formData.load_weight_kg}
                  onChange={e => setFormData({ ...formData, load_weight_kg: e.target.value })}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Required temperature (°C, reefer only)</label>
                <input
                  type="number"
                  placeholder="-18"
                  value={formData.temperature_requirement}
                  onChange={e => setFormData({ ...formData, temperature_requirement: e.target.value })}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white"
                />
              </div>
            </div>

            {customers.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Customer (optional)</label>
                <select
                  value={formData.customer_id}
                  onChange={e => setFormData({ ...formData, customer_id: e.target.value })}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white appearance-none cursor-pointer"
                >
                  <option value="">No customer linked</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Special Instructions</label>
              <textarea
                value={formData.special_instructions}
                onChange={e => setFormData({...formData, special_instructions: e.target.value.slice(0, 500)})}
                placeholder="e.g. fragile cargo, forklift required"
                rows={2}
                maxLength={500}
                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white resize-none text-sm"
              />
            </div>

            {editingAppointment && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Status Protocol</label>
                <select 
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value})}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all focus:border-indigo-600 focus:bg-white appearance-none cursor-pointer"
                >
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="CHECKED_IN">Checked In</option>
                  <option value="LOADING">Loading</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="LATE">Late</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            )}

            <div className="flex items-center justify-between pt-6 border-t border-slate-100">
               <div className="flex gap-4">
                  <button 
                    type="button"
                    onClick={() => setFormData({...formData, priority_level: formData.priority_level === 1 ? 2 : 1})}
                    className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all uppercase tracking-widest border ${formData.priority_level === 1 ? 'bg-rose-50 border-rose-200 text-rose-600 shadow-lg shadow-rose-100' : 'bg-white border-slate-200 text-slate-400'}`}
                  >
                    High Priority
                  </button>
               </div>
               <div className="flex gap-4">
                  <button 
                    type="button" 
                    onClick={onClose}
                    className="px-8 py-4 rounded-2xl font-bold text-slate-400 hover:text-slate-900 transition-all uppercase tracking-widest text-[11px]"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={submitting}
                    className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center gap-2 hover:translate-y-[-2px] active:translate-y-0"
                  >
                    {submitting ? "Processing..." : editingAppointment ? "Update Booking" : "Commit Booking"}
                    <ArrowRight size={18} />
                  </button>
               </div>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
