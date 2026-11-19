import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export const SearchInput = ({
  value,
  onChange,
  onClear,
  placeholder = "Search...",
  className
}) => {
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-3 h-4 w-4 text-slate-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-[#0f172a] border border-slate-700/80 py-1.5 pl-9 pr-8 text-sm text-slate-200 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
      />
      {value && (
        <button
          onClick={onClear || (() => onChange(''))}
          className="absolute right-2.5 p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
