// src/components/BookingRequestsSidebar.tsx
import React, { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Package, Clock, X } from "lucide-react";

export interface BookingRequestCard {
  id: number;
  plate: string;
  carrier: string;
  personal_id_number: string;
  cargo_type: string;
  cargo_quantity: string | null;
  load_type: string;
  created_at: string;
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// ponytail: this repo has no @types/react installed, so JSX's normal "key
// isn't a real prop" exclusion doesn't apply to strictly-typed components —
// any typed component used with key={} hits TS2322. Declaring key here (kept
// out of BookingRequestCard, the brief's real interface) satisfies tsc
// without loosening the component's actual prop typing. Real fix: add
// @types/react + @types/react-dom as devDependencies repo-wide (separate task).
function DraggableRequestCard({ request }: { request: BookingRequestCard; key?: React.Key }) {
  // No transform: the Calendar's DragOverlay renders what follows the
  // cursor, so this card stays put and dims instead of moving twice.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `request-${request.id}`,
    data: { type: "request", request },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`bg-white border border-slate-200 rounded-xl p-2.5 cursor-grab active:cursor-grabbing shadow-sm hover:border-indigo-300 hover:shadow-md transition-all touch-none ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="font-black text-slate-900 text-xs">{request.plate}</p>
        <span className="text-[8px] font-bold text-slate-400 flex items-center gap-1"><Clock size={8} /> {timeAgo(request.created_at)}</span>
      </div>
      <p className="text-[11px] font-bold text-slate-500 truncate">{request.carrier}</p>
      <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-600">
        <Package size={10} className="text-indigo-400 shrink-0" />
        <span className="truncate">{request.cargo_type}{request.cargo_quantity ? ` · ${request.cargo_quantity}` : ""}</span>
      </div>
      <p className="text-[9px] text-slate-400 mt-0.5">ID: {request.personal_id_number}</p>
    </div>
  );
}

export default function BookingRequestsSidebar({ refreshKey, onClose }: { refreshKey?: number; onClose?: () => void }) {
  const [requests, setRequests] = useState<BookingRequestCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/booking-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRequests)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="w-60 shrink-0 bg-slate-50/50 border border-slate-200 rounded-2xl p-3 h-[70vh] overflow-y-auto custom-scrollbar">
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <h3 className="font-bold text-slate-900 text-xs">Booking requests</h3>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 transition-colors shrink-0" aria-label="Hide booking requests">
            <X size={14} />
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-500 mb-3">Drag a card onto a time slot to schedule it.</p>
      {loading && <p className="text-[11px] text-slate-400 text-center py-8">Loading...</p>}
      {!loading && requests.length === 0 && <p className="text-[11px] text-slate-400 text-center py-8">No pending requests.</p>}
      <div className="space-y-2">
        {requests.map((r) => <DraggableRequestCard key={r.id} request={r} />)}
      </div>
    </div>
  );
}
