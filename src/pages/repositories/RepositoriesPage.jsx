import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { SearchInput } from '../../components/common/SearchInput';
import { StatusBadge } from '../../components/common/StatusBadge';
import { EmptyState } from '../../components/common/EmptyState';
import {
  GitBranch,
  Plus,
  FolderCode,
  FileArchive,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Filter,
  Layers,
  Sparkles,
  X,
  CheckCircle2,
  UploadCloud,
  FileCheck2
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const RepositoriesPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { repositories, projects, connectRepository, reanalyzeRepository, addToast } = useApp();

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [langFilter, setLangFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);

  // Check if query param ?action=connect was passed
  useEffect(() => {
    if (searchParams.get('action') === 'connect') {
      setModalOpen(true);
    }
  }, [searchParams]);

  // Connect Repository Modal State
  const [sourceMethod, setSourceMethod] = useState('github'); // 'github' | 'local' | 'zip'
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ingestionStep, setIngestionStep] = useState(0);

  const [githubForm, setGithubForm] = useState({
    url: 'https://github.com/retail-corp/store-service.git',
    branch: 'main',
    startingCommit: 'e82b19f',
    isPrivate: false,
    projectId: projects[0]?.id || 'proj-1',
  });

  const [localForm, setLocalForm] = useState({
    name: 'internal-data-service',
    path: '/Users/developer/repos/internal-data-service',
    branch: 'main',
    startingCommit: '9a01f42',
    projectId: projects[0]?.id || 'proj-1',
  });

  const [zipForm, setZipForm] = useState({
    file: null,
    fileName: 'microservice-auth-v2.zip',
    fileSize: '5.2 MB',
    projectId: projects[0]?.id || 'proj-1',
  });

  // Unique languages
  const allLanguages = Array.from(new Set(repositories.map((r) => r.primaryLanguage)));

  // Filtered repositories
  const filtered = repositories.filter((repo) => {
    const matchesSearch =
      repo.name.toLowerCase().includes(search.toLowerCase()) ||
      repo.description.toLowerCase().includes(search.toLowerCase());
    const matchesSource =
      sourceFilter === 'all' || repo.sourceType.toLowerCase() === sourceFilter.toLowerCase();
    const matchesLang =
      langFilter === 'all' || repo.primaryLanguage.toLowerCase() === langFilter.toLowerCase();
    return matchesSearch && matchesSource && matchesLang;
  });

  // Handle ingestion flow
  const handleConnectSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setIngestionStep(1);

    // Simulate multi-step ingestion: Clone -> Parse AST -> Detect APIs -> Generate Graph
    setTimeout(() => setIngestionStep(2), 700);
    setTimeout(() => setIngestionStep(3), 1400);
    setTimeout(() => {
      let repoName = "New-Repository";
      let repoData = {};

      if (sourceMethod === 'github') {
        const parts = githubForm.url.split('/');
        repoName = parts[parts.length - 1]?.replace('.git', '') || 'github-repo';
        repoData = {
          name: repoName,
          sourceType: 'github',
          sourceUrl: githubForm.url,
          branch: githubForm.branch,
          startingCommit: githubForm.startingCommit,
          projectId: githubForm.projectId,
          description: 'GitHub synchronized repository analyzed by TaskForge AST engine.',
          primaryLanguage: 'JavaScript',
          frameworks: ['React', 'Node.js', 'Express', 'Tailwind CSS']
        };
      } else if (sourceMethod === 'local') {
        repoName = localForm.name;
        repoData = {
          name: repoName,
          sourceType: 'local',
          sourceUrl: localForm.path,
          branch: localForm.branch,
          startingCommit: localForm.startingCommit,
          projectId: localForm.projectId,
          description: 'Local workspace repository mapped via internal connector daemon.',
          primaryLanguage: 'JavaScript',
          frameworks: ['Node.js', 'PostgreSQL', 'Express']
        };
      } else {
        repoName = zipForm.fileName.replace('.zip', '');
        repoData = {
          name: repoName,
          sourceType: 'zip',
          sourceUrl: zipForm.fileName,
          branch: 'main',
          startingCommit: 'zip-root',
          projectId: zipForm.projectId,
          description: 'Compressed archive package extracted and indexed in isolated sandbox.',
          primaryLanguage: 'JavaScript',
          frameworks: ['React', 'Vite', 'Tailwind CSS']
        };
      }

      const connected = connectRepository(repoData);
      setIsSubmitting(false);
      setIngestionStep(0);
      setModalOpen(false);
      navigate(`/repositories/${connected.id}`);
    }, 2200);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repository Management"
        description="Connect, analyze, and manage target software repositories used for coding benchmark generation."
        actions={
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Connect Repository</span>
          </button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter repositories by name, framework, or path..."
          className="w-full sm:w-80"
        />

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Sources</option>
            <option value="github">GitHub Repositories (Active)</option>
            <option value="local" disabled>Local Connector (On Hold)</option>
            <option value="zip" disabled>ZIP Ingestion (On Hold)</option>
          </select>

          <select
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Languages</option>
            {allLanguages.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 6.1 Repository Management Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No repositories found"
          description="No connected repositories match your query. Connect a GitHub repository, local folder, or upload a ZIP archive."
          action={
            <button
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium"
            >
              Connect Repository
            </button>
          }
        />
      ) : (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800/80 overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3 px-4">Repository</th>
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Language & Tech</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Commit</th>
                  <th className="py-3 px-4">Analysis</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((repo) => (
                  <tr
                    key={repo.id}
                    onClick={() => navigate(`/repositories/${repo.id}`)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors group"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                        {repo.name}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate max-w-xs">{repo.description}</div>
                    </td>

                    <td className="py-3 px-4 text-slate-300">
                      {repo.projectName}
                    </td>

                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300">
                        {repo.sourceType === 'github' && <GitBranch className="h-3.5 w-3.5 text-indigo-400" />}
                        {repo.sourceType === 'local' && <FolderCode className="h-3.5 w-3.5 text-amber-400" />}
                        {repo.sourceType === 'zip' && <FileArchive className="h-3.5 w-3.5 text-violet-400" />}
                        <span className="capitalize">{repo.sourceType}</span>
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-200">{repo.primaryLanguage}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                        {(repo.frameworks || []).slice(0, 2).join(', ')}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-slate-300">
                      {repo.branch}
                    </td>

                    <td className="py-3 px-4 font-mono text-indigo-400">
                      {repo.lastAnalyzedCommit}
                    </td>

                    <td className="py-3 px-4">
                      <StatusBadge status={repo.analysisStatus || 'Completed'} />
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => reanalyzeRepository(repo.id)}
                          title="Re-analyze repository"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => navigate(`/benchmarks/create?repoId=${repo.id}`)}
                          title="Generate benchmark from this repo"
                          className="px-2.5 py-1 rounded-md bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600 hover:text-white text-[11px] font-medium transition-colors"
                        >
                          Create Bench
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6.2 Connect Repository Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-xl rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Connect Software Repository</h3>
              </div>
              <button
                onClick={() => !isSubmitting && setModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Ingestion Progress State */}
            {isSubmitting ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="relative">
                  <RefreshCw className="h-10 w-10 text-indigo-500 animate-spin" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">
                    {ingestionStep === 1 && "Cloning repository workspace..."}
                    {ingestionStep === 2 && "Analyzing Abstract Syntax Trees (AST) & APIs..."}
                    {ingestionStep === 3 && "Synthesizing Architecture Graph & Models..."}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    Simulating repository ingestion, file indexing, and dependency mapping.
                  </p>
                </div>
                <div className="w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${(ingestionStep / 3) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnectSubmit} className="mt-4 space-y-4">
                {/* Source Selection Tabs */}
                <div className="grid grid-cols-3 gap-2 p-1 rounded-lg bg-slate-900 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSourceMethod('github')}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold bg-indigo-600 text-white shadow-sm transition-colors"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    <span>GitHub Repo</span>
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded font-mono">Active</span>
                  </button>

                  <div
                    title="Local Repository ingestion is currently on hold"
                    className="flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium text-slate-500 bg-slate-900/60 border border-dashed border-slate-800 cursor-not-allowed select-none opacity-60"
                  >
                    <FolderCode className="h-3.5 w-3.5 text-slate-500" />
                    <span>Local Connector</span>
                    <span className="text-[9px] bg-slate-800 text-amber-400 px-1 py-0.2 rounded font-mono">On Hold</span>
                  </div>

                  <div
                    title="ZIP archive ingestion is currently on hold"
                    className="flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium text-slate-500 bg-slate-900/60 border border-dashed border-slate-800 cursor-not-allowed select-none opacity-60"
                  >
                    <FileArchive className="h-3.5 w-3.5 text-slate-500" />
                    <span>ZIP Upload</span>
                    <span className="text-[9px] bg-slate-800 text-amber-400 px-1 py-0.2 rounded font-mono">On Hold</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-indigo-950/20 border border-indigo-900/30 text-[11px] text-indigo-300 flex items-center justify-between">
                  <span>GitHub Repository ingestion is currently the primary authorized input mode.</span>
                  <span className="font-mono text-slate-400">HTTPS / SSH</span>
                </div>

                {/* Target Project Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Associate with Project *
                  </label>
                  <select
                    value={githubForm.projectId}
                    onChange={(e) => {
                      setGithubForm({ ...githubForm, projectId: e.target.value });
                      setLocalForm({ ...localForm, projectId: e.target.value });
                      setZipForm({ ...zipForm, projectId: e.target.value });
                    }}
                    className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Method A: GitHub Form */}
                {sourceMethod === 'github' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Repository HTTPS / SSH Clone URL *
                      </label>
                      <input
                        type="url"
                        required
                        value={githubForm.url}
                        onChange={(e) => setGithubForm({ ...githubForm, url: e.target.value })}
                        placeholder="https://github.com/organization/repository.git"
                        className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Default Branch
                        </label>
                        <input
                          type="text"
                          value={githubForm.branch}
                          onChange={(e) => setGithubForm({ ...githubForm, branch: e.target.value })}
                          className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                          Baseline Commit SHA (Optional)
                        </label>
                        <input
                          type="text"
                          value={githubForm.startingCommit}
                          onChange={(e) => setGithubForm({ ...githubForm, startingCommit: e.target.value })}
                          className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">
                      TaskForge accesses public repositories directly. Private repos utilize configured GitHub tokens in Settings.
                    </div>
                  </div>
                )}

                {/* Method B: Local Form */}
                {sourceMethod === 'local' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Repository Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={localForm.name}
                        onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })}
                        className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                        Local File System Path *
                      </label>
                      <input
                        type="text"
                        required
                        value={localForm.path}
                        onChange={(e) => setLocalForm({ ...localForm, path: e.target.value })}
                        className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 text-xs text-amber-300">
                      Notice: Local repository synchronization runs via an authorized local agent bridge or Docker bind mount.
                    </div>
                  </div>
                )}

                {/* Method C: ZIP Upload Form */}
                {sourceMethod === 'zip' && (
                  <div className="space-y-3">
                    <div className="border-2 border-dashed border-slate-700 rounded-xl p-6 text-center bg-slate-900/40 hover:border-indigo-500/50 transition-colors">
                      <UploadCloud className="h-8 w-8 text-indigo-400 mx-auto mb-2" />
                      <div className="text-xs font-semibold text-white">
                        {zipForm.fileName} ({zipForm.fileSize})
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Drag and drop codebase .zip archive or click to browse
                      </p>
                      <button
                        type="button"
                        className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                      >
                        Browse Files
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
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
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Connect & Analyze</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
