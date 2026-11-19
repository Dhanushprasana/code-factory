import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderGit2,
  GitBranch,
  Cpu,
  PlaySquare,
  Trophy,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Terminal,
  BarChart2
} from 'lucide-react';
import { cn } from '../../lib/utils';

export const Sidebar = ({ collapsed, setCollapsed }) => {
  const location = useLocation();

  const navGroups = [
    {
      group: "Workspace",
      items: [
        { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
        { name: "Projects", path: "/projects", icon: FolderGit2 },
        { name: "Repositories", path: "/repositories", icon: GitBranch },
      ],
    },
    {
      group: "Benchmarking",
      items: [
        { name: "Benchmark Factory", path: "/benchmarks", icon: Cpu },
        { name: "Benchmark Runner", path: "/runs", icon: PlaySquare },
      ],
    },
    {
      group: "Insights",
      items: [
        { name: "Results & Reports", path: "/results", icon: BarChart2 },
        { name: "Leaderboard", path: "/leaderboard", icon: Trophy },
      ],
    },
    {
      group: "Configuration",
      items: [
        { name: "Settings", path: "/settings", icon: Sliders },
      ],
    },
  ];

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-slate-800/80 bg-[#0c1220] transition-all duration-300",
        collapsed ? "w-18" : "w-64"
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-4">
        <NavLink to="/dashboard" className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-md shadow-indigo-500/20 text-white font-bold text-lg">
            <Sparkles className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                TaskForge
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  AI-BENCH
                </span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium truncate">
                AI Coding Benchmark Platform
              </span>
            </div>
          )}
        </NavLink>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/60 bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group, idx) => (
          <div key={idx}>
            {!collapsed && (
              <h3 className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.group}
              </h3>
            )}
            <nav className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(item.path);

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative",
                      isActive
                        ? "bg-indigo-600/15 text-indigo-400 font-semibold border border-indigo-500/30 shadow-sm"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent"
                    )}
                  >
                    <Icon className={cn("h-4.5 w-4.5 shrink-0 transition-transform group-hover:scale-105", isActive ? "text-indigo-400" : "text-slate-400")} />
                    {!collapsed && <span className="truncate">{item.name}</span>}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-indigo-500" />
                    )}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      {/* Simulated Mode Banner & Profile Footer */}
      <div className="border-t border-slate-800/80 p-3 space-y-2">
        {!collapsed && (
          <div className="rounded-lg bg-indigo-950/40 border border-indigo-800/40 p-2.5 text-[11px] text-indigo-300 flex items-start gap-2">
            <Terminal className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block text-indigo-200">Interactive Simulation Mode</span>
              Platform operations and agent executions are simulated with local state.
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg p-2 bg-slate-900/60 border border-slate-800/80">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-indigo-300 font-bold text-xs border border-indigo-500/30">
            GC
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-white truncate">Gary Chen</span>
              <span className="text-[10px] text-slate-400 truncate">Senior Benchmark Architect</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
