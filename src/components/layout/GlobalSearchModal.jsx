import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  Search,
  FolderGit2,
  GitBranch,
  Cpu,
  PlaySquare,
  Trophy,
  ArrowRight,
  X
} from 'lucide-react';
import { cn } from '../../lib/utils';

export const GlobalSearchModal = () => {
  const {
    globalSearchOpen,
    setGlobalSearchOpen,
    projects,
    repositories,
    benchmarks,
    runs
  } = useApp();

  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => {
    if (globalSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [globalSearchOpen]);

  if (!globalSearchOpen) return null;

  const q = query.toLowerCase().trim();

  const filteredProjects = q
    ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
    : projects.slice(0, 3);

  const filteredRepos = q
    ? repositories.filter((r) => r.name.toLowerCase().includes(q) || r.primaryLanguage.toLowerCase().includes(q))
    : repositories.slice(0, 3);

  const filteredBenchmarks = q
    ? benchmarks.filter((b) => b.name.toLowerCase().includes(q) || b.featureCategory.toLowerCase().includes(q))
    : benchmarks.slice(0, 3);

  const filteredRuns = q
    ? runs.filter((r) => r.benchmarkName.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    : runs.slice(0, 3);

  const handleSelect = (url) => {
    setGlobalSearchOpen(false);
    navigate(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0f172a] border border-slate-700/80 shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[75vh]">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-800 bg-[#111827]">
          <Search className="h-5 w-5 text-slate-400 shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, repositories, benchmarks, execution runs..."
            className="w-full bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded text-slate-400 hover:text-white mr-2"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setGlobalSearchOpen(false)}
            className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
          >
            ESC
          </button>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-3 space-y-4">
          {/* Projects */}
          {filteredProjects.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FolderGit2 className="h-3.5 w-3.5 text-indigo-400" />
                Projects
              </div>
              <div className="space-y-1">
                {filteredProjects.map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => handleSelect(`/projects/${proj.id}`)}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 cursor-pointer transition-colors group"
                  >
                    <div>
                      <div className="text-sm font-medium text-white group-hover:text-indigo-300">
                        {proj.name}
                      </div>
                      <div className="text-xs text-slate-400 line-clamp-1">{proj.description}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Repositories */}
          {filteredRepos.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
                Repositories
              </div>
              <div className="space-y-1">
                {filteredRepos.map((repo) => (
                  <div
                    key={repo.id}
                    onClick={() => handleSelect(`/repositories/${repo.id}`)}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 cursor-pointer transition-colors group"
                  >
                    <div>
                      <div className="text-sm font-medium text-white group-hover:text-emerald-300">
                        {repo.name}
                      </div>
                      <div className="text-xs text-slate-400">{repo.primaryLanguage} • {repo.projectName}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Benchmarks */}
          {filteredBenchmarks.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-violet-400" />
                Benchmarks
              </div>
              <div className="space-y-1">
                {filteredBenchmarks.map((bench) => (
                  <div
                    key={bench.id}
                    onClick={() => handleSelect(`/benchmarks/${bench.id}`)}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 cursor-pointer transition-colors group"
                  >
                    <div>
                      <div className="text-sm font-medium text-white group-hover:text-violet-300">
                        {bench.name}
                      </div>
                      <div className="text-xs text-slate-400">{bench.featureCategory} • {bench.complexity} • {bench.repositoryName}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Runs */}
          {filteredRuns.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <PlaySquare className="h-3.5 w-3.5 text-amber-400" />
                Benchmark Runs
              </div>
              <div className="space-y-1">
                {filteredRuns.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => handleSelect(`/runs/${r.id}`)}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/80 cursor-pointer transition-colors group"
                  >
                    <div>
                      <div className="text-sm font-medium text-white group-hover:text-amber-300">
                        Run #{r.id} — {r.benchmarkName}
                      </div>
                      <div className="text-xs text-slate-400">{r.status} • Best: {r.bestPerformingAgent} ({r.highestScore})</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-800 bg-[#0d1322] flex items-center justify-between text-xs text-slate-500">
          <span>Navigate with mouse or arrow keys</span>
          <span>TaskForge Universal Index</span>
        </div>
      </div>
    </div>
  );
};
