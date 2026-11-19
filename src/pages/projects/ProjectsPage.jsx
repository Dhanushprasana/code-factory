import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { SearchInput } from '../../components/common/SearchInput';
import { StatusBadge } from '../../components/common/StatusBadge';
import { EmptyState } from '../../components/common/EmptyState';
import {
  FolderGit2,
  Plus,
  GitBranch,
  Cpu,
  PlaySquare,
  Trophy,
  ArrowRight,
  Tag,
  Clock,
  Layers,
  X
} from 'lucide-react';
import { formatTimeAgo } from '../../lib/utils';

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const { projects, createProject } = useApp();
  const [search, setSearch] = useState('');
  const [filterTag, setFilterTag] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);

  // New project modal form state
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    tags: 'React, Node.js',
  });

  // Extract all unique tags
  const allTags = Array.from(new Set(projects.flatMap((p) => p.tags || [])));

  // Filter projects
  const filtered = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    const matchesTag =
      filterTag === 'all' || (p.tags && p.tags.includes(filterTag));
    return matchesSearch && matchesTag;
  });

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (!newProject.name.trim()) return;

    createProject({
      name: newProject.name,
      description: newProject.description,
      tags: newProject.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });

    setNewProject({ name: '', description: '', tags: 'React, Node.js' });
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Organize software repositories, targeted benchmark suites, and agent evaluation history."
        actions={
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Create Project</span>
          </button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter projects by title, description..."
          className="w-full sm:w-80"
        />

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <span className="text-xs text-slate-400 font-medium">Tag:</span>
          <button
            onClick={() => setFilterTag('all')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
              filterTag === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-[#0f172a] text-slate-400 hover:text-slate-200 border border-slate-700/80'
            }`}
          >
            All
          </button>
          {allTags.slice(0, 5).map((tag) => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${
                filterTag === tag
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#0f172a] text-slate-400 hover:text-slate-200 border border-slate-700/80'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Projects Grid / Cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects match your filter"
          description="Try clearing your search query or create a new project workspace."
          action={
            <button
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium"
            >
              Create New Project
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="group flex flex-col justify-between rounded-xl bg-[#0f172a] border border-slate-800/80 hover:border-indigo-500/50 p-5 cursor-pointer transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/5"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition-transform">
                      <FolderGit2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
                        {project.name}
                      </h3>
                      <span className="text-[11px] text-slate-400 font-mono">
                        ID: {project.id}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={project.status || 'Active'} />
                </div>

                <p className="mt-3 text-xs text-slate-300 line-clamp-2 leading-relaxed">
                  {project.description}
                </p>

                {/* Tags */}
                {project.tags && project.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700/60"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Metrics Footer */}
              <div className="mt-5 pt-4 border-t border-slate-800/80">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-1 rounded bg-slate-900/60 border border-slate-800">
                    <div className="text-xs font-bold text-white font-mono">{project.repositoryCount}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400">Repos</div>
                  </div>
                  <div className="p-1 rounded bg-slate-900/60 border border-slate-800">
                    <div className="text-xs font-bold text-indigo-300 font-mono">{project.benchmarkCount}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400">Suites</div>
                  </div>
                  <div className="p-1 rounded bg-slate-900/60 border border-slate-800">
                    <div className="text-xs font-bold text-white font-mono">{project.executionCount}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400">Runs</div>
                  </div>
                  <div className="p-1 rounded bg-slate-900/60 border border-slate-800">
                    <div className="text-xs font-bold text-emerald-400 font-mono">{project.averageScore}%</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-400">Avg</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimeAgo(project.lastActivity)}
                  </span>
                  <span className="flex items-center gap-1 text-indigo-400 font-medium group-hover:translate-x-0.5 transition-transform">
                    <span>Open project</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FolderGit2 className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Create New Project</h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Distributed Analytics Pipeline"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Summarize the core software systems and agent evaluation goals..."
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Tags (Comma separated)
                </label>
                <input
                  type="text"
                  placeholder="React, Microservices, Python, Redis"
                  value={newProject.tags}
                  onChange={(e) => setNewProject({ ...newProject, tags: e.target.value })}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
