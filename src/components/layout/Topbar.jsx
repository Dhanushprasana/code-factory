import React, { useState, useRef, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  Search,
  Bell,
  HelpCircle,
  ChevronRight,
  FolderKanban,
  Check,
  ExternalLink,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import { cn, formatTimeAgo } from '../../lib/utils';

export const Topbar = ({ collapsed }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    setGlobalSearchOpen
  } = useApp();

  const [notifOpen, setNotifOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const notifRef = useRef(null);
  const projectRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
      if (projectRef.current && !projectRef.current.contains(e.target)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setGlobalSearchOpen]);

  // Compute breadcrumbs
  const pathParts = location.pathname.split('/').filter(Boolean);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md px-6 transition-all duration-300",
          collapsed ? "ml-18" : "ml-64"
        )}
      >
        {/* Left: Breadcrumbs & Project Selector */}
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-2 text-sm text-slate-400">
            <Link to="/dashboard" className="hover:text-slate-200 transition-colors">
              TaskForge
            </Link>
            {pathParts.map((part, idx) => {
              const url = `/${pathParts.slice(0, idx + 1).join('/')}`;
              const isLast = idx === pathParts.length - 1;
              return (
                <React.Fragment key={url}>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                  <Link
                    to={url}
                    className={cn(
                      "capitalize transition-colors",
                      isLast ? "font-semibold text-white" : "hover:text-slate-200"
                    )}
                  >
                    {part}
                  </Link>
                </React.Fragment>
              );
            })}
          </nav>

          {/* Project Selector Dropdown */}
          <div className="relative hidden md:block" ref={projectRef}>
            <button
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#0f172a] border border-slate-700/80 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
            >
              <FolderKanban className="h-3.5 w-3.5 text-indigo-400" />
              <span>{selectedProject ? selectedProject.name : 'All Projects'}</span>
            </button>

            {projectMenuOpen && (
              <div className="absolute left-0 mt-2 w-64 rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Switch Active Project
                </div>
                <button
                  onClick={() => {
                    setSelectedProjectId('all');
                    setProjectMenuOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors",
                    selectedProjectId === 'all'
                      ? "bg-indigo-600/20 text-indigo-300"
                      : "text-slate-300 hover:bg-slate-800"
                  )}
                >
                  <span>All Projects (Global Scope)</span>
                  {selectedProjectId === 'all' && <Check className="h-3.5 w-3.5 text-indigo-400" />}
                </button>
                <div className="my-1 border-t border-slate-800" />
                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    onClick={() => {
                      setSelectedProjectId(proj.id);
                      setProjectMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors truncate",
                      selectedProjectId === proj.id
                        ? "bg-indigo-600/20 text-indigo-300"
                        : "text-slate-300 hover:bg-slate-800"
                    )}
                  >
                    <span className="truncate">{proj.name}</span>
                    {selectedProjectId === proj.id && <Check className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Search, Notifications, Help, User */}
        <div className="flex items-center gap-3">
          {/* Quick Search trigger */}
          <button
            onClick={() => setGlobalSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0f172a] border border-slate-700/80 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors w-44 sm:w-56"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="truncate">Search TaskForge...</span>
            <kbd className="ml-auto hidden sm:inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 border border-slate-700">
              ⌘K
            </kbd>
          </button>

          {/* Notifications Dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
              title="Notifications"
            >
              <Bell className="h-4.5 w-4.5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-indigo-500 animate-ping" />
              )}
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-indigo-500" />
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-mono border border-indigo-500/30">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllNotificationsRead}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60 py-1">
                  {notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => {
                        markNotificationRead(notif.id);
                        if (notif.link) {
                          navigate(notif.link);
                          setNotifOpen(false);
                        }
                      }}
                      className={cn(
                        "p-3 rounded-lg cursor-pointer transition-colors text-left",
                        !notif.read ? "bg-indigo-950/20 hover:bg-indigo-950/40" : "hover:bg-slate-800/50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-white">{notif.title}</span>
                        <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                          {formatTimeAgo(notif.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300 line-clamp-2">{notif.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Help Info Button */}
          <button
            onClick={() => setHelpOpen(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
            title="Platform Architecture & Guidance"
          >
            <HelpCircle className="h-4.5 w-4.5" />
          </button>

          {/* User profile small avatar */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
              GC
            </div>
          </div>
        </div>
      </header>

      {/* Help Modal */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-xl rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-400" />
                <h3 className="text-lg font-bold text-white">TaskForge Architecture Guide</h3>
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-800/40">
                <h4 className="font-semibold text-indigo-200 text-xs uppercase tracking-wider mb-1">
                  Core Evaluation Mission
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  TaskForge evaluates autonomous AI coding agents on their capability to understand and extend <strong>existing software repositories</strong> through structured feature tasks, reference implementations, and hidden verification test suites.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-white text-xs uppercase tracking-wider mb-1">
                  1. LLM Providers vs. Coding Agents
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong>LLM Providers</strong> (Gemini, OpenRouter, OpenAI, Anthropic) interpret repos, discover features, and author tests.
                  <strong>Coding Agents</strong> (Antigravity, Codex, Claude Code) are autonomous coding runtimes executed in isolated containers to implement benchmark requirements.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-white text-xs uppercase tracking-wider mb-1">
                  2. Scoring Model Breakdown
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Overall evaluations use provisional weights: <strong>60% Functional Correctness</strong> (hidden feature tests), <strong>25% Regression Safety</strong> (baseline test suites), <strong>10% Code Quality</strong>, and <strong>5% Execution Reliability</strong>.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setHelpOpen(false)}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
