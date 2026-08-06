import React, { createContext, useContext, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
}

const ToastContext = createContext<{
  toast: (message: string, type?: Toast["type"], duration?: number) => void;
}>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = (message: string, type: Toast["type"] = "info", duration = 5000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev.slice(-2), { id, type, message, duration }]); // limit to 3
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col-reverse gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              className={`
                pointer-events-auto cursor-pointer p-4 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[320px] max-w-[400px] border backdrop-blur-xl
                ${t.type === 'success' ? 'bg-[var(--c-teal)]/20 border-[var(--c-teal)]/50 text-[var(--c-teal)]' : 
                  t.type === 'error' ? 'bg-[var(--c-red)]/20 border-[var(--c-red)]/50 text-[var(--c-red)]' : 
                  t.type === 'warning' ? 'bg-[var(--c-amber)]/20 border-[var(--c-amber)]/50 text-[var(--c-amber)]' : 
                  'bg-[var(--c-blue)]/20 border-[var(--c-blue)]/50 text-[var(--c-blue)]'}
              `}
            >
              <div className="shrink-0">
                {t.type === 'success' && <CheckCircle2 size={20} />}
                {t.type === 'error' && <AlertCircle size={20} />}
                {t.type === 'warning' && <AlertTriangle size={20} />}
                {t.type === 'info' && <Info size={20} />}
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-wider opacity-60 mb-0.5">{t.type}</p>
                <p className="text-sm font-medium text-white">{t.message}</p>
              </div>
              <button className="opacity-40 hover:opacity-100 transition-opacity">
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
