import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { SearchInput } from '../../components/common/SearchInput';
import { StatusBadge } from '../../components/common/StatusBadge';
import { EmptyState } from '../../components/common/EmptyState';
import {
  Trophy,
  BarChart2,
  TrendingUp,
  Clock,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Filter,
  Layers,
  ChevronRight,
  PieChart
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  Cell
} from 'recharts';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const ResultsPage = () => {
  const navigate = useNavigate();
  const { evaluations, runs } = useApp();

  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState('30d');
  const [statusFilter, setStatusFilter] = useState('all');

  // Performance comparison data
  const comparisonData = [
    { name: 'Antigravity', functional: 96, regression: 98, overall: 94.2, time: 7.3 },
    { name: 'Codex', functional: 91, regression: 95, overall: 90.4, time: 8.5 },
    { name: 'Claude Code', functional: 88, regression: 92, overall: 88.6, time: 9.6 },
    { name: 'Gemini CLI', functional: 82, regression: 90, overall: 85.2, time: 6.5 },
  ];

  // Performance over time data
  const trendData = [
    { week: 'W1', Antigravity: 90.5, Codex: 88.0, Claude: 86.5, Gemini: 82.0 },
    { week: 'W2', Antigravity: 91.8, Codex: 89.2, Claude: 87.0, Gemini: 83.5 },
    { week: 'W3', Antigravity: 93.4, Codex: 90.0, Claude: 88.1, Gemini: 84.8 },
    { week: 'W4', Antigravity: 94.2, Codex: 90.4, Claude: 88.6, Gemini: 85.2 },
  ];

  const filteredEvals = evaluations.filter((ev) => {
    const matchesSearch =
      ev.benchmarkName.toLowerCase().includes(search.toLowerCase()) ||
      ev.repositoryName.toLowerCase().includes(search.toLowerCase()) ||
      ev.winningAgent.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' || ev.status.toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evaluation Results & Benchmark Reports"
        description="Analyze multi-agent performance, automated evaluation reports, and code change diffs."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>

            <button
              onClick={() => navigate('/leaderboard')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Trophy className="h-4 w-4" />
              <span>Universal Leaderboard</span>
            </button>
          </div>
        }
      />

      {/* 9.1 Overview Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Runs</span>
          <div className="mt-2 text-2xl font-bold font-mono text-white">128</div>
          <div className="mt-1 text-xs text-slate-400">Recorded benchmark tests</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Submissions</span>
          <div className="mt-2 text-2xl font-bold font-mono text-indigo-400">412</div>
          <div className="mt-1 text-xs text-slate-400">Agent git patches graded</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Average Score</span>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">89.4%</div>
          <div className="mt-1 text-xs text-slate-400">Across all feature domains</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Test Pass Rate</span>
          <div className="mt-2 text-2xl font-bold font-mono text-white">92.6%</div>
          <div className="mt-1 text-xs text-slate-400">Feature & regression checks</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Best Agent</span>
          <div className="mt-2 text-lg font-bold text-indigo-300 truncate">Antigravity</div>
          <div className="mt-1 text-xs text-slate-400">92.8% Average Score</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Success Rate</span>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">96.8%</div>
          <div className="mt-1 text-xs text-slate-400">Clean run completions</div>
        </div>
      </div>

      {/* 9.2 Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Feature vs Regression Pass Rate */}
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">Functional Correctness vs. Regression Safety</h3>
            <p className="text-xs text-slate-400">Hidden feature test passes (60% weight) vs. pre-existing test preservation (25% weight)</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis domain={[75, 100]} stroke="#64748b" fontSize={11} tickLine={false} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="functional" name="Feature Tests % (60% weight)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="regression" name="Regression Tests % (25% weight)" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Performance Over Time */}
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">Agent Benchmark Score Trends</h3>
            <p className="text-xs text-slate-400">Evaluation score trajectories over the past 4 weeks</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="week" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis domain={[80, 100]} stroke="#64748b" fontSize={11} tickLine={false} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line type="monotone" dataKey="Antigravity" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Codex" stroke="#10a37f" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Claude" stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Gemini" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 9.3 Results Table */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search evaluation reports..."
            className="w-full sm:w-80"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3 px-4">Benchmark</th>
                  <th className="py-3 px-4">Repository</th>
                  <th className="py-3 px-4 text-center">Agents</th>
                  <th className="py-3 px-4">Winning Agent</th>
                  <th className="py-3 px-4 text-right">Top Score</th>
                  <th className="py-3 px-4 text-right">Avg Score</th>
                  <th className="py-3 px-4 text-right">Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredEvals.map((ev) => (
                  <tr
                    key={ev.id}
                    onClick={() => navigate(`/results/${ev.id}`)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors truncate max-w-xs">
                        {ev.benchmarkName}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">Report #{ev.id}</div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300">
                      {ev.repositoryName}
                    </td>

                    <td className="py-3.5 px-4 text-center font-mono font-medium text-white">
                      {ev.agentsEvaluated}
                    </td>

                    <td className="py-3.5 px-4 font-semibold text-indigo-300">
                      {ev.winningAgent}
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400">
                      {ev.highestScore}%
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                      {ev.averageScore}%
                    </td>

                    <td className="py-3.5 px-4 text-right text-slate-400 font-mono">
                      {formatDate(ev.date)}
                    </td>

                    <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate(`/results/${ev.id}`)}
                        className="px-2.5 py-1 rounded-md bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600 hover:text-white text-[11px] font-semibold transition-colors"
                      >
                        Inspect Report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
