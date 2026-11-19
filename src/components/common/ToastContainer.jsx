import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export const ToastContainer = () => {
  const { toasts, removeToast } = useApp();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        let icon = <Info className="h-5 w-5 text-indigo-400" />;
        let border = "border-indigo-500/30";
        let bg = "bg-[#0f172a]/95";

        if (toast.type === 'success') {
          icon = <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
          border = "border-emerald-500/30";
        } else if (toast.type === 'error') {
          icon = <AlertCircle className="h-5 w-5 text-rose-400" />;
          border = "border-rose-500/30";
        } else if (toast.type === 'warning') {
          icon = <AlertTriangle className="h-5 w-5 text-amber-400" />;
          border = "border-amber-500/30";
        }

        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all duration-200 animate-in slide-in-from-bottom-5",
              bg,
              border
            )}
          >
            <div className="shrink-0 mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-white">{toast.title}</h4>
              {toast.message && (
                <p className="mt-0.5 text-xs text-slate-300 leading-relaxed">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 text-slate-400 hover:text-white p-0.5 rounded transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
