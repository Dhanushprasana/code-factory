import React from 'react';
import { cn } from '../../lib/utils';

export const PageHeader = ({
  title,
  description,
  badge,
  actions,
  children,
  className
}) => {
  return (
    <div className={cn("mb-6 pb-4 border-b border-slate-800/80", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
            {badge}
          </div>
          {description && (
            <p className="mt-1 text-sm text-slate-400 max-w-3xl">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2.5 flex-wrap">
            {actions}
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
};
