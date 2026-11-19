import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { EmptyState } from '../../components/common/EmptyState';
import {
  FolderGit2,
  GitBranch,
  Cpu,
  PlaySquare,
  Activity,
  ArrowLeft,
  Plus,
  ExternalLink,
  Clock,
  Layers,
  ChevronRight,
  ShieldCheck,
  Tag
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const ProjectDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, repositories, benchmarks, runs, activities } = useApp();
  const [activeTab, setActiveTab] = useState('overview');

  const project = projects.find((p) => p.id === id) || projects[0];

  const projectRepos = repositories.filter((r) => r.projectId === project.id);
  const projectBenchmarks = benchmarks.filter((b) => b.projectId === project.id);
  const projectRuns = runs.filter((r) => r.projectId === project.id);
  const projectActivities = activities.filter((a) => a.entityId === project.id || projectRepos.some(r => r.id === a.entityId));

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'repositories', label: `Repositories (${projectRepos.length})` },
    { key: 'benchmarks', label: `Benchmarks (${projectBenchmarks.length})` },
    { key: 'runs', label: `Runs (${projectRuns.length})` },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="space-y-6">
      {/* Back button and page header */}
      <div>
        <button
          onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Projects</span>
        </button>

        <PageHeader
          title={project.name}
          description={project.description}
          badge={<StatusBadge status={project.status || 'Active'} />}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/repositories?action=connect')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
              >
                <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
                <span>Connect Repo</span>
              </button>
              <button
                onClick={() => navigate('/benchmarks/create')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Create Benchmark</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Tabs navigation */}
      <div className="border-b border-slate-800">
        <nav className="flex space-x-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-white font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-4">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Repositories</span>
              <div className="mt-2 text-2xl font-bold font-mono text-white">{projectRepos.length}</div>
              <div className="mt-1 text-xs text-slate-500">Connected source codebases</div>
            </div>
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-4">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Benchmarks</span>
              <div className="mt-2 text-2xl font-bold font-mono text-indigo-400">{projectBenchmarks.length}</div>
              <div className="mt-1 text-xs text-slate-500">Generated task suites</div>
            </div>
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-4">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Runs</span>
              <div className="mt-2 text-2xl font-bold font-mono text-white">{projectRuns.length}</div>
              <div className="mt-1 text-xs text-slate-500">Agent executions executed</div>
            </div>
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-4">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Average Score</span>
              <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">{project.averageScore}%</div>
              <div className="mt-1 text-xs text-slate-500">Overall evaluation pass</div>
            </div>
          </div>

          {/* Project Details Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">Project Information</h3>
              <div className="divide-y divide-slate-800 text-xs">
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Project ID</span>
                  <span className="font-mono text-slate-200">{project.id}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <StatusBadge status={project.status || 'Active'} />
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Last Active</span>
                  <span className="text-slate-200">{formatDate(project.lastActivity)}</span>
                </div>
                <div className="py-2.5 flex justify-between items-center">
                  <span className="text-slate-400">Target Tech Stack</span>
                  <div className="flex gap-1 flex-wrap">
                    {(project.tags || []).map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Primary Repositories</h3>
                <button
                  onClick={() => setActiveTab('repositories')}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  View all
                </button>
              </div>
              <div className="space-y-2">
                {projectRepos.slice(0, 3).map((repo) => (
                  <div
                    key={repo.id}
                    onClick={() => navigate(`/repositories/${repo.id}`)}
                    className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between transition-colors"
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">{repo.name}</div>
                      <div className="text-[11px] text-slate-400">{repo.primaryLanguage} • Branch: {repo.branch}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Repositories */}
      {activeTab === 'repositories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Repositories in this Project</h3>
            <button
              onClick={() => navigate('/repositories?action=connect')}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Connect Repository</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projectRepos.map((repo) => (
              <div
                key={repo.id}
                onClick={() => navigate(`/repositories/${repo.id}`)}
                className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-white group-hover:text-indigo-300">{repo.name}</h4>
                      <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{repo.description}</p>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {repo.sourceType}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                    <span>Lang: <strong className="text-slate-200">{repo.primaryLanguage}</strong></span>
                    <span>Commit: <strong className="font-mono text-slate-200">{repo.lastAnalyzedCommit}</strong></span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-indigo-400">
                  <span>View repository details</span>
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Benchmarks */}
      {activeTab === 'benchmarks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Project Benchmark Suites</h3>
            <button
              onClick={() => navigate('/benchmarks/create')}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Benchmark</span>
            </button>
          </div>

          <div className="space-y-3">
            {projectBenchmarks.map((bench) => (
              <div
                key={bench.id}
                onClick={() => navigate(`/benchmarks/${bench.id}`)}
                className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all flex items-center justify-between group"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-semibold text-white group-hover:text-indigo-300">{bench.name}</h4>
                    <StatusBadge status={bench.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                    <span>Repo: {bench.repositoryName}</span>
                    <span>•</span>
                    <span>Category: {bench.featureCategory}</span>
                    <span>•</span>
                    <span>Complexity: {bench.complexity}</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-500 group-hover:translate-x-1 transition-transform" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Runs */}
      {activeTab === 'runs' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-white">Execution History</h3>
          <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Run ID</th>
                  <th className="py-2.5 px-4">Benchmark</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Top Agent</th>
                  <th className="py-2.5 px-4 text-right">Score</th>
                  <th className="py-2.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {projectRuns.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/runs/${r.id}`)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-indigo-400">{r.id}</td>
                    <td className="py-3 px-4 text-white font-medium">{r.benchmarkName}</td>
                    <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
                    <td className="py-3 px-4 text-slate-200">{r.bestPerformingAgent}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-white">{r.highestScore}%</td>
                    <td className="py-3 px-4 text-right text-slate-400">{formatTimeAgo(r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Activity */}
      {activeTab === 'activity' && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Project Activity Log</h3>
          <div className="space-y-3">
            {projectActivities.length === 0 ? (
              <p className="text-xs text-slate-400">No recent activity recorded for this project.</p>
            ) : (
              projectActivities.map((act) => (
                <div key={act.id} className="flex items-start gap-3 text-xs pb-3 border-b border-slate-800/60 last:border-0">
                  <div className="h-6 w-6 rounded bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                    <Activity className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className="font-semibold text-white">{act.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{formatTimeAgo(act.timestamp)}</span>
                    </div>
                    <p className="text-slate-300 mt-0.5">{act.description}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
