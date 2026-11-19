import React from 'react';
import { cn } from '../../lib/utils';
import { CheckCircle2, Clock, AlertTriangle, XCircle, PlayCircle, ShieldCheck, FileEdit } from 'lucide-react';

export const StatusBadge = ({ status, className }) => {
  if (!status) return null;
  const s = status.toLowerCase();

  let styles = "bg-slate-800/80 text-slate-300 border-slate-700/60";
  let icon = <Clock className="w-3.5 h-3.5 mr-1" />;

  if (s === 'ready' || s === 'completed' || s === 'active' || s === 'passed' || s === 'approved') {
    styles = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    icon = <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />;
  } else if (s === 'running' || s === 'evaluating' || s === 'generating' || s === 'preparing') {
    styles = "bg-indigo-500/15 text-indigo-300 border-indigo-500/30 animate-pulse";
    icon = <PlayCircle className="w-3.5 h-3.5 mr-1 text-indigo-400" />;
  } else if (s === 'validating' || s === 'queued' || s === 'awaiting review' || s === 'warning') {
    styles = "bg-amber-500/10 text-amber-400 border-amber-500/30";
    icon = <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-400" />;
  } else if (s === 'failed' || s === 'validation failed' || s === 'cancelled' || s === 'rejected') {
    styles = "bg-rose-500/10 text-rose-400 border-rose-500/30";
    icon = <XCircle className="w-3.5 h-3.5 mr-1 text-rose-400" />;
  } else if (s === 'draft' || s === 'archived') {
    styles = "bg-slate-800/90 text-slate-400 border-slate-700";
    icon = <FileEdit className="w-3.5 h-3.5 mr-1 text-slate-400" />;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border tracking-wide select-none",
        styles,
        className
      )}
    >
      {icon}
      <span className="capitalize">{status}</span>
    </span>
  );
};
