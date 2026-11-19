import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import {
  Trophy,
  Medal,
  TrendingUp,
  Clock,
  ShieldCheck,
  Filter,
  Layers,
  ArrowRight,
  Info,
  Sparkles
} from 'lucide-react';

export const LeaderboardPage = () => {
  const navigate = useNavigate();
  const { leaderboard } = useApp();

  const [viewType, setViewType] = useState('overall'); // 'overall' | 'category' | 'complexity'
  const [selectedCategory, setSelectedCategory] = useState('E-commerce');
  const [selectedComplexity, setSelectedComplexity] = useState('Medium');
  const [timeRange, setTimeRange] = useState('all');

  const categories = ['E-commerce', 'Authorization', 'Performance', 'Security', 'API Development'];
  const complexities = ['Easy', 'Medium', 'Hard', 'Expert'];

  // Sort and rank dynamically based on selected view
  const rankedAgents = [...leaderboard].sort((a, b) => {
    if (viewType === 'category') {
      const scoreA = a.categoryScores?.[selectedCategory] || a.averageScore;
      const scoreB = b.categoryScores?.[selectedCategory] || b.averageScore;
      return scoreB - scoreA;
    }
    if (viewType === 'complexity') {
      const scoreA = a.complexityScores?.[selectedComplexity] || a.averageScore;
      const scoreB = b.complexityScores?.[selectedComplexity] || b.averageScore;
      return scoreB - scoreA;
    }
    return b.averageScore - a.averageScore;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coding Agent Leaderboard"
        description="Empirical benchmark performance rankings across functional correctness, regression safety, and execution speed."
      />

      {/* Population Comparison Disclaimer Notice (Section 9.5 requirement) */}
      <div className="p-3.5 rounded-xl bg-indigo-950/20 border border-indigo-800/40 text-xs text-indigo-300 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block text-indigo-200">Standardized Population Scope:</span>
          Rankings are calculated across verified benchmark suites with identical repository baseline states and hidden test harnesses. Agents with divergent benchmark samples are evaluated within their respective population slices.
        </div>
      </div>

      {/* View Switcher & Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl bg-[#0f172a] border border-slate-800">
        <div className="flex items-center gap-1 bg-[#141e33] p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          {[
            { id: 'overall', label: 'Overall Leaderboard' },
            { id: 'category', label: 'By Feature Category' },
            { id: 'complexity', label: 'By Complexity Tier' },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setViewType(v.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                viewType === v.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {viewType === 'category' && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-[#111827] border border-slate-700 text-xs font-semibold text-white rounded-lg px-2.5 py-1.5 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}

          {viewType === 'complexity' && (
            <select
              value={selectedComplexity}
              onChange={(e) => setSelectedComplexity(e.target.value)}
              className="bg-[#111827] border border-slate-700 text-xs font-semibold text-white rounded-lg px-2.5 py-1.5 focus:outline-none"
            >
              {complexities.map((c) => (
                <option key={c} value={c}>{c} Tier</option>
              ))}
            </select>
          )}

          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="bg-[#111827] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All-Time Benchmark Cohort</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3.5 px-4 text-center w-16">Rank</th>
                <th className="py-3.5 px-4">Autonomous Coding Agent</th>
                <th className="py-3.5 px-4">Provider & Model</th>
                <th className="py-3.5 px-4 text-center">Evaluations</th>
                <th className="py-3.5 px-4 text-right">
                  {viewType === 'category' ? `${selectedCategory} Score` : viewType === 'complexity' ? `${selectedComplexity} Score` : 'Average Score'}
                </th>
                <th className="py-3.5 px-4 text-right">Feature Pass Rate</th>
                <th className="py-3.5 px-4 text-right">Regression Safety</th>
                <th className="py-3.5 px-4 text-right">Avg Execution Time</th>
                <th className="py-3.5 px-4 text-right">Completion Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {rankedAgents.map((agent, index) => {
                const rank = index + 1;
                const score =
                  viewType === 'category'
                    ? agent.categoryScores?.[selectedCategory] || agent.averageScore
                    : viewType === 'complexity'
                    ? agent.complexityScores?.[selectedComplexity] || agent.averageScore
                    : agent.averageScore;

                return (
                  <tr
                    key={agent.agentId}
                    className={`hover:bg-slate-800/50 transition-colors ${
                      rank === 1 ? 'bg-indigo-950/20' : ''
                    }`}
                  >
                    <td className="py-4 px-4 text-center">
                      <div className="flex items-center justify-center">
                        {rank === 1 ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold">
                            1
                          </div>
                        ) : rank === 2 ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-400/20 text-slate-300 border border-slate-400/40 font-bold">
                            2
                          </div>
                        ) : rank === 3 ? (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-700/20 text-amber-500 border border-amber-700/40 font-bold">
                            3
                          </div>
                        ) : (
                          <span className="text-slate-500 font-bold">{rank}</span>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-4 font-sans font-bold text-white">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{agent.agentName}</span>
                        {rank === 1 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Leader
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-4 font-sans text-slate-300">
                      <div>{agent.provider}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{agent.model}</div>
                    </td>

                    <td className="py-4 px-4 text-center text-slate-300 font-bold">
                      {agent.evaluationsCount}
                    </td>

                    <td className="py-4 px-4 text-right text-base font-bold text-emerald-400">
                      {score.toFixed(1)}%
                    </td>

                    <td className="py-4 px-4 text-right text-indigo-300">
                      {agent.featurePassRate}%
                    </td>

                    <td className="py-4 px-4 text-right text-slate-300">
                      {agent.regressionPassRate}%
                    </td>

                    <td className="py-4 px-4 text-right text-slate-400">
                      {agent.averageExecutionTime}
                    </td>

                    <td className="py-4 px-4 text-right text-slate-300">
                      {agent.successCompletionRate}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
