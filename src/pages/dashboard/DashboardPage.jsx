import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatCard } from '../../components/common/StatCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { BenchmarkActivityChart } from '../../components/charts/BenchmarkActivityChart';
import { AgentPerformanceChart } from '../../components/charts/AgentPerformanceChart';
import {
  FolderGit2,
  GitBranch,
  Cpu,
  PlaySquare,
  Activity,
  Trophy,
  Plus,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  Zap
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { projects, repositories, benchmarks, runs, activities, selectedProjectId, setSelectedProjectId, addToast } = useApp();
  const [dateRange, setDateRange] = useState('30d');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      addToast({
        title: "Dashboard Refreshed",
        message: "Metrics and real-time execution states synchronized.",
        type: "info"
      });
    }, 600);
  };

  const filteredRuns = selectedProjectId === 'all'
    ? runs
    : runs.filter((r) => r.projectId === selectedProjectId);

  const activeRunsCount = runs.filter((r) => r.status === 'Running' || r.status === 'Evaluating').length || 3;

  return (
    <div className="space-y-6">
      {/* 4.1 Page Header */}
      <PageHeader
        title="Dashboard"
        description="Monitor your repositories, benchmarks, agent executions, and evaluation performance."
        actions={
          <>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => navigate('/benchmarks/create')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Create Benchmark</span>
            </button>
          </>
        }
      />

      {/* 4.7 Quick Action Banner Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => navigate('/repositories?action=connect')}
          className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-indigo-950/40 to-slate-900 border border-indigo-900/30 hover:border-indigo-500/50 text-left transition-all group"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 group-hover:scale-105 transition-transform">
            <GitBranch className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white group-hover:text-indigo-300">Connect Repo</div>
            <div className="text-[11px] text-slate-400">Ingest GitHub or ZIP</div>
          </div>
        </button>

        <button
          onClick={() => navigate('/benchmarks/create')}
          className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-violet-950/40 to-slate-900 border border-violet-900/30 hover:border-violet-500/50 text-left transition-all group"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400 group-hover:scale-105 transition-transform">
            <Cpu className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white group-hover:text-violet-300">Create Benchmark</div>
            <div className="text-[11px] text-slate-400">Feature discovery wizard</div>
          </div>
        </button>

        <button
          onClick={() => navigate('/runs')}
          className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-900/30 hover:border-emerald-500/50 text-left transition-all group"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/20 text-emerald-400 group-hover:scale-105 transition-transform">
            <PlaySquare className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white group-hover:text-emerald-300">Run Benchmark</div>
            <div className="text-[11px] text-slate-400">Dispatch multi-agent test</div>
          </div>
        </button>

        <button
          onClick={() => navigate('/results')}
          className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-amber-950/40 to-slate-900 border border-amber-900/30 hover:border-amber-500/50 text-left transition-all group"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-600/20 text-amber-400 group-hover:scale-105 transition-transform">
            <Trophy className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white group-hover:text-amber-300">View Results</div>
            <div className="text-[11px] text-slate-400">Reports & leaderboard</div>
          </div>
        </button>
      </div>

      {/* 4.2 Overview Statistics (Six cards) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          title="Total Projects"
          value={projects.length || 12}
          change="+2"
          isPositive={true}
          icon={FolderGit2}
          link="/projects"
        />
        <StatCard
          title="Connected Repos"
          value={repositories.length || 18}
          change="+4"
          isPositive={true}
          icon={GitBranch}
          link="/repositories"
        />
        <StatCard
          title="Generated Benchmarks"
          value={benchmarks.length || 46}
          change="+12"
          isPositive={true}
          icon={Cpu}
          link="/benchmarks"
        />
        <StatCard
          title="Completed Runs"
          value="128"
          change="+18%"
          isPositive={true}
          icon={PlaySquare}
          link="/runs"
        />
        <StatCard
          title="Active Runs"
          value={activeRunsCount}
          change="Live"
          isPositive={true}
          icon={Activity}
          link="/runs"
        />
        <StatCard
          title="Agent Evaluations"
          value="342"
          change="+24%"
          isPositive={true}
          icon={Trophy}
          link="/results"
        />
      </div>

      {/* 4.3 & 4.4 Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BenchmarkActivityChart />
        <AgentPerformanceChart />
      </div>

      {/* 4.5 Recent Benchmark Runs Table & 4.6 Activity Feed Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table: 2 cols on lg */}
        <div className="lg:col-span-2 rounded-xl bg-[#0f172a] border border-slate-800/80 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-white">Recent Benchmark Runs</h3>
                <p className="text-xs text-slate-400">Latest multi-agent executions and automated evaluation scores</p>
              </div>
              <button
                onClick={() => navigate('/runs')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
              >
                <span>View all runs</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-900/50">
                  <tr>
                    <th className="py-2.5 px-3">Benchmark</th>
                    <th className="py-2.5 px-3">Repository</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Top Agent</th>
                    <th className="py-2.5 px-3 text-right">Score</th>
                    <th className="py-2.5 px-3 text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredRuns.slice(0, 6).map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => navigate(`/runs/${run.id}`)}
                      className="hover:bg-slate-800/60 cursor-pointer transition-colors group"
                    >
                      <td className="py-3 px-3">
                        <div className="font-semibold text-white group-hover:text-indigo-300 truncate max-w-[180px]">
                          {run.benchmarkName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">Run #{run.id}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-300 truncate max-w-[120px]">
                        {run.repositoryName}
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-3 px-3 text-slate-200 font-medium">
                        {run.bestPerformingAgent || '--'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-white">
                        {run.highestScore !== '--' ? `${run.highestScore}%` : '--'}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-400 font-mono">
                        {formatTimeAgo(run.startedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 4.6 Activity Feed (1 col on lg) */}
        <div className="rounded-xl bg-[#0f172a] border border-slate-800/80 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-white">Platform Activity</h3>
              <p className="text-xs text-slate-400">Audit trail of benchmarks and agent runs</p>
            </div>
            <Activity className="h-4 w-4 text-slate-400" />
          </div>

          <div className="flex-1 overflow-y-auto max-h-[380px] space-y-3.5 pr-1">
            {activities.slice(0, 8).map((act) => (
              <div key={act.id} className="flex items-start gap-3 text-xs">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700/60 text-slate-300 mt-0.5">
                  {act.type.includes('eval') ? (
                    <Trophy className="h-3.5 w-3.5 text-amber-400" />
                  ) : act.type.includes('repo') ? (
                    <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
                  ) : act.type.includes('bench') ? (
                    <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                  ) : (
                    <PlaySquare className="h-3.5 w-3.5 text-sky-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-slate-200 truncate">{act.title}</span>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {formatTimeAgo(act.timestamp)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-400 line-clamp-2 leading-relaxed">
                    {act.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
