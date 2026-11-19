import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { SearchInput } from '../../components/common/SearchInput';
import { StatusBadge } from '../../components/common/StatusBadge';
import { EmptyState } from '../../components/common/EmptyState';
import {
  PlaySquare,
  Plus,
  Play,
  CheckCircle2,
  Cpu,
  GitBranch,
  Bot,
  Sliders,
  Clock,
  ChevronRight,
  ShieldAlert,
  Server,
  Layers,
  Sparkles,
  X,
  FileCode2
} from 'lucide-react';
import { formatDate, formatTimeAgo, formatDuration } from '../../lib/utils';

export const RunsPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { runs, benchmarks, agents, environments, startBenchmarkRun, addToast } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [launcherOpen, setLauncherOpen] = useState(false);

  // Auto-open launcher if ?benchmarkId= is present in URL
  const paramBenchId = searchParams.get('benchmarkId');
  useEffect(() => {
    if (paramBenchId) {
      setSelectedBenchmarkId(paramBenchId);
      setLauncherOpen(true);
    }
  }, [paramBenchId]);

  // Launcher State
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState(benchmarks[0]?.id || 'bench-1');
  const [selectedAgentIds, setSelectedAgentIds] = useState(['agent-antigravity', 'agent-codex', 'agent-claude', 'agent-gemini']);
  const [selectedEnvId, setSelectedEnvId] = useState(environments[0]?.id || 'env-1');
  const [resourceLimits, setResourceLimits] = useState({
    cpu: '4 vCPUs',
    memory: '8 GB RAM',
    timeout: '25 min',
    network: 'Filtered (Egress to package registries only)'
  });

  const selectedBenchmark = benchmarks.find((b) => b.id === selectedBenchmarkId) || benchmarks[0];
  const selectedEnv = environments.find((e) => e.id === selectedEnvId) || environments[0];

  const toggleAgent = (agentId) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleLaunch = () => {
    if (selectedAgentIds.length === 0) {
      addToast({
        title: 'Agent Selection Required',
        message: 'Please select at least one coding agent to participate in the benchmark run.',
        type: 'warning'
      });
      return;
    }

    const newRun = startBenchmarkRun({
      benchmarkId: selectedBenchmark.id,
      agentIds: selectedAgentIds,
      runtimeEnvironment: selectedEnv.name,
      resourceLimits: {
        cpu: resourceLimits.cpu,
        memory: resourceLimits.memory,
        timeout: resourceLimits.timeout,
      }
    });

    setLauncherOpen(false);
    navigate(`/runs/${newRun.id}`);
  };

  // Filter runs
  const filteredRuns = runs.filter((r) => {
    const matchesSearch =
      r.benchmarkName.toLowerCase().includes(search.toLowerCase()) ||
      r.repositoryName.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' || r.status.toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Benchmark Runner"
        description="Coordinate, orchestrate, and observe autonomous coding agents executing against standardized benchmarks."
        actions={
          <button
            onClick={() => setLauncherOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Play className="h-4 w-4" />
            <span>Launch Benchmark Run</span>
          </button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search execution runs by benchmark, repository, ID..."
          className="w-full sm:w-80"
        />

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Run Statuses</option>
            <option value="running">Running / Live</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Runs Table */}
      {filteredRuns.length === 0 ? (
        <EmptyState
          icon={PlaySquare}
          title="No execution runs found"
          description="Launch a benchmark execution to start testing coding agents in parallel."
          action={
            <button
              onClick={() => setLauncherOpen(true)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium"
            >
              Launch Run
            </button>
          }
        />
      ) : (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800/80 overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3 px-4">Run ID</th>
                  <th className="py-3 px-4">Benchmark Package</th>
                  <th className="py-3 px-4">Repository</th>
                  <th className="py-3 px-4">Agents Evaluated</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Top Agent</th>
                  <th className="py-3 px-4 text-right">Score</th>
                  <th className="py-3 px-4 text-right">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => navigate(`/runs/${run.id}`)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                  >
                    <td className="py-3.5 px-4 font-mono font-bold text-indigo-400">
                      #{run.id}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors truncate max-w-xs">
                        {run.benchmarkName}
                      </div>
                      <div className="text-[10px] text-slate-400 font-sans">
                        Env: {run.runtimeEnvironment}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300">
                      {run.repositoryName}
                    </td>

                    <td className="py-3.5 px-4 text-slate-300 font-mono">
                      {(run.participatingAgents || []).length} Agents
                    </td>

                    <td className="py-3.5 px-4">
                      <StatusBadge status={run.status} />
                    </td>

                    <td className="py-3.5 px-4 font-medium text-slate-200">
                      {run.bestPerformingAgent || '--'}
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
                      {run.highestScore !== '--' ? `${run.highestScore}%` : '--'}
                    </td>

                    <td className="py-3.5 px-4 text-right text-slate-400 font-mono">
                      {formatTimeAgo(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LAUNCH BENCHMARK RUN MODAL (Sections 8.1 - 8.4) */}
      {launcherOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="w-full max-w-3xl rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-6 text-slate-200 space-y-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <PlaySquare className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Configure Benchmark Execution</h3>
              </div>
              <button
                onClick={() => setLauncherOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 8.1 Select Benchmark */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                1. Select Benchmark Package *
              </label>
              <select
                value={selectedBenchmarkId}
                onChange={(e) => setSelectedBenchmarkId(e.target.value)}
                className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {benchmarks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.repositoryName} • {b.complexity} • {b.version})
                  </option>
                ))}
              </select>

              {selectedBenchmark && (
                <div className="mt-2 p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                  <span>Target: <strong className="text-white">{selectedBenchmark.repositoryName}</strong></span>
                  <span>Commit: <strong className="font-mono text-indigo-400">{selectedBenchmark.taskSpecification?.startingCommitSha || 'c4a9f21'}</strong></span>
                  <span>Tests: <strong className="text-emerald-400">22 Hidden Checks</strong></span>
                </div>
              )}
            </div>

            {/* 8.2 Select Coding Agents */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  2. Select Participating Coding Agents ({selectedAgentIds.length} Selected) *
                </label>
                <span className="text-[11px] text-slate-400">Agents execute in independent parallel sandboxes</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {agents.map((agent) => {
                  const isChecked = selectedAgentIds.includes(agent.id);
                  return (
                    <div
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                        isChecked
                          ? 'bg-indigo-950/25 border-indigo-500 ring-1 ring-indigo-500'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-1 rounded text-indigo-600 focus:ring-0 bg-slate-800 border-slate-700"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-white truncate">{agent.name}</h4>
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                            {agent.provider}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{agent.description}</p>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                          <span>Avg: {agent.scoreAvg}%</span>
                          <span>•</span>
                          <span>Time: {Math.round(agent.executionTimeAvg / 60)}m</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 8.3 Execution Environment & Resource Limits */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Runtime Profile *
                </label>
                <select
                  value={selectedEnvId}
                  onChange={(e) => setSelectedEnvId(e.target.value)}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>{env.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Execution Timeout & Memory
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={resourceLimits.timeout}
                    onChange={(e) => setResourceLimits({ ...resourceLimits, timeout: e.target.value })}
                    className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-2.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={resourceLimits.memory}
                    onChange={(e) => setResourceLimits({ ...resourceLimits, memory: e.target.value })}
                    className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-2.5 text-xs text-white"
                  />
                </div>
              </div>
            </div>

            {/* Notice */}
            <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-800/40 text-xs text-indigo-300">
              <strong>Simulated Isolation Guarantee:</strong> Each agent runs in its own simulated clean worktree container. Code edits, self-testing, submission extraction, and hidden-test grading are monitored in real time.
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setLauncherOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLaunch}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20"
              >
                <Play className="h-4 w-4" />
                <span>Start Benchmark Run</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
