import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export const StatCard = ({
  title,
  value,
  change,
  period = "vs previous period",
  isPositive = true,
  icon: Icon,
  link,
  className
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (link) navigate(link);
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "group relative overflow-hidden rounded-xl bg-[#0f172a]/90 border border-slate-800/80 p-5 transition-all duration-200",
        link && "cursor-pointer hover:border-indigo-500/50 hover:bg-[#141e33] hover:shadow-lg hover:shadow-indigo-500/5",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {title}
        </span>
        {Icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800/80 text-indigo-400 border border-slate-700/50 group-hover:bg-indigo-500/10 group-hover:text-indigo-300 transition-colors">
            <Icon className="h-4.5 w-4.5" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-2xl font-bold tracking-tight text-white font-mono">
          {value}
        </div>
        {link && (
          <ArrowUpRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 group-hover:text-indigo-400 transition-all" />
        )}
      </div>

      {(change || period) && (
        <div className="mt-3 flex items-center text-xs">
          {change && (
            <span
              className={cn(
                "inline-flex items-center font-medium mr-1.5",
                isPositive ? "text-emerald-400" : "text-rose-400"
              )}
            >
              {isPositive ? (
                <TrendingUp className="mr-0.5 h-3 w-3" />
              ) : (
                <TrendingDown className="mr-0.5 h-3 w-3" />
              )}
              {change}
            </span>
          )}
          <span className="text-slate-400">{period}</span>
        </div>
      )}
    </div>
  );
};
