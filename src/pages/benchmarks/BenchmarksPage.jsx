import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { SearchInput } from '../../components/common/SearchInput';
import { StatusBadge } from '../../components/common/StatusBadge';
import { EmptyState } from '../../components/common/EmptyState';
import {
  Cpu,
  Plus,
  PlaySquare,
  GitBranch,
  Layers,
  ChevronRight,
  Filter,
  CheckCircle2,
  AlertTriangle,
  History,
  Tag
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const BenchmarksPage = () => {
  const navigate = useNavigate();
  const { benchmarks, repositories, projects } = useApp();

  const [search, setSearch] = useState('');
  const [repoFilter, setRepoFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [complexityFilter, setComplexityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const categories = [
    'E-commerce',
    'Authorization',
    'User Management',
    'Performance',
    'Security',
    'Notifications',
    'API Development'
  ];

  const filtered = benchmarks.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.repositoryName.toLowerCase().includes(search.toLowerCase()) ||
      b.taskSpecification?.title?.toLowerCase().includes(search.toLowerCase());
    const matchesRepo = repoFilter === 'all' || b.repositoryId === repoFilter;
    const matchesStatus = statusFilter === 'all' || b.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesComplexity = complexityFilter === 'all' || b.complexity.toLowerCase() === complexityFilter.toLowerCase();
    const matchesCategory = categoryFilter === 'all' || b.featureCategory.toLowerCase() === categoryFilter.toLowerCase();

    return matchesSearch && matchesRepo && matchesStatus && matchesComplexity && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Benchmark Factory"
        description="Design, synthesize, validate, and package rigorous coding benchmarks from existing codebases."
        actions={
          <button
            onClick={() => navigate('/benchmarks/create')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Create Benchmark</span>
          </button>
        }
      />

      {/* Dimension Selector & Feature-Wise Categorization */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">Benchmarking View:</span>
          <div className="inline-flex rounded-lg bg-slate-800/80 p-0.5 border border-slate-700/60">
            <button
              onClick={() => {}}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-600 text-white shadow"
            >
              Feature-Wise (Primary)
            </button>
            <button
              onClick={() => {}}
              className="px-2.5 py-1 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200"
              title="Add-on view: Repository-wise benchmark grouping"
            >
              Repo-Wise (Add-on)
            </button>
            <button
              onClick={() => {}}
              className="px-2.5 py-1 text-xs font-medium rounded-md text-slate-400 hover:text-slate-200"
              title="Add-on view: Overall global benchmark suite"
            >
              Overall (Add-on)
            </button>
          </div>
        </div>
        <div className="text-[11px] text-slate-400">
          Showing <span className="text-white font-medium">{filtered.length}</span> benchmarks evaluated by feature capabilities
        </div>
      </div>

      {/* Feature Category Quick Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
            categoryFilter === 'all'
              ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50 font-semibold'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          All Features
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              categoryFilter === c
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50 font-semibold'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter benchmarks by title, repo, or spec..."
          className="w-full lg:w-72"
        />

        <div className="flex items-center gap-2 overflow-x-auto w-full lg:w-auto pb-1 lg:pb-0">
          <select
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Repositories</option>
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="ready">Ready</option>
            <option value="validating">Validating</option>
            <option value="awaiting review">Awaiting Review</option>
            <option value="draft">Draft</option>
          </select>

          <select
            value={complexityFilter}
            onChange={(e) => setComplexityFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Complexities</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
            <option value="expert">Expert</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 7.1 Benchmark Listing Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No benchmarks found"
          description="No benchmark packages match your filters. Launch the multi-step benchmark wizard to generate one."
          action={
            <button
              onClick={() => navigate('/benchmarks/create')}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium"
            >
              Launch Benchmark Creator
            </button>
          }
        />
      ) : (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800/80 overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3 px-4">Benchmark Package</th>
                  <th className="py-3 px-4">Repository</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Complexity</th>
                  <th className="py-3 px-4">Version</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Runs</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((bench) => {
                  let compColor = "bg-blue-500/10 text-blue-400 border-blue-500/20";
                  if (bench.complexity === 'Medium') compColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                  if (bench.complexity === 'Hard') compColor = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                  if (bench.complexity === 'Expert') compColor = "bg-purple-500/10 text-purple-400 border-purple-500/20";

                  return (
                    <tr
                      key={bench.id}
                      onClick={() => navigate(`/benchmarks/${bench.id}`)}
                      className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                          {bench.name}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-xs">
                          {bench.taskSpecification?.title || bench.featureCategory}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-300">
                        <span className="flex items-center gap-1.5">
                          <GitBranch className="h-3.5 w-3.5 text-slate-400" />
                          <span>{bench.repositoryName}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-300">
                        {bench.featureCategory}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${compColor}`}>
                          {bench.complexity}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px]">
                        {bench.version}
                      </td>

                      <td className="py-3.5 px-4">
                        <StatusBadge status={bench.status} />
                      </td>

                      <td className="py-3.5 px-4 text-center font-mono font-medium text-white">
                        {bench.executionCount || 0}
                      </td>

                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => navigate(`/runs?benchmarkId=${bench.id}`)}
                            title="Execute Benchmark in Runner"
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors"
                          >
                            <PlaySquare className="h-3 w-3" />
                            <span>Run</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
