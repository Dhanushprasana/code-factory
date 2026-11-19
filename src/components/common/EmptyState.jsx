import React from 'react';
import { FolderSearch } from 'lucide-react';
import { cn } from '../../lib/utils';

export const EmptyState = ({
  icon: Icon = FolderSearch,
  title = "No results found",
  description = "No items match your selected filters or search query.",
  action,
  className
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-[#0f172a]/40 p-12 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/80 text-slate-400 border border-slate-700/60 mb-4">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-400 max-w-sm">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
};
