import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { SearchInput } from '../../components/common/SearchInput';
import {
  GitBranch,
  ArrowLeft,
  RefreshCw,
  Cpu,
  FolderTree,
  Network,
  Webhook,
  Database,
  Package,
  TestTube2,
  History,
  Folder,
  FileCode,
  FileText,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Code2,
  Server,
  Key,
  ShieldCheck
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const RepositoryDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { repositories, reanalyzeRepository, addToast } = useApp();

  const repo = repositories.find((r) => r.id === id) || repositories[0];
  const [activeTab, setActiveTab] = useState('overview');

  // File Explorer State
  const [selectedFile, setSelectedFile] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({ src: true, 'src/components': true, server: true });

  // API Search State
  const [apiSearch, setApiSearch] = useState('');
  const [apiMethodFilter, setApiMethodFilter] = useState('all');

  // Dependency Filter State
  const [depTypeFilter, setDepTypeFilter] = useState('all');

  // Re-analyze simulation state
  const [analyzing, setAnalyzing] = useState(false);

  const handleReanalyze = () => {
    setAnalyzing(true);
    setTimeout(() => {
      reanalyzeRepository(repo.id);
      setAnalyzing(false);
    }, 1000);
  };

  const toggleFolder = (folderPath) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const tabs = [
    { key: 'overview', label: 'Overview', icon: GitBranch },
    { key: 'explorer', label: 'File Explorer', icon: FolderTree },
    { key: 'apis', label: `APIs (${repo.apis?.length || 0})`, icon: Webhook },
    { key: 'models', label: `Data Models (${repo.dataModels?.length || 0})`, icon: Database },
    { key: 'dependencies', label: `Dependencies (${repo.dependencies?.length || 0})`, icon: Package },
    { key: 'architecture', label: 'Architecture (On Hold)', icon: Network, onHold: true },
  ];

  // Filter APIs
  const filteredApis = (repo.apis || []).filter((api) => {
    const matchesSearch =
      api.endpoint.toLowerCase().includes(apiSearch.toLowerCase()) ||
      api.handler.toLowerCase().includes(apiSearch.toLowerCase()) ||
      api.module.toLowerCase().includes(apiSearch.toLowerCase());
    const matchesMethod =
      apiMethodFilter === 'all' || api.method.toLowerCase() === apiMethodFilter.toLowerCase();
    return matchesSearch && matchesMethod;
  });

  // Filter Dependencies
  const filteredDeps = (repo.dependencies || []).filter((dep) => {
    if (depTypeFilter === 'all') return true;
    return dep.type.toLowerCase() === depTypeFilter.toLowerCase();
  });

  // Recursive File Tree Node
  const renderTreeNode = (item, currentPath = '') => {
    const fullPath = currentPath ? `${currentPath}/${item.name}` : item.name;
    const isDir = item.type === 'directory';
    const isExpanded = !!expandedFolders[fullPath];
    const isSelected = selectedFile?.name === item.name;

    if (isDir) {
      return (
        <div key={fullPath} className="select-none">
          <div
            onClick={() => toggleFolder(fullPath)}
            className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-slate-800/60 cursor-pointer text-xs text-slate-300 font-medium"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            )}
            <Folder className="h-4 w-4 text-indigo-400" />
            <span>{item.name}</span>
          </div>

          {isExpanded && item.children && (
            <div className="pl-4 ml-2 border-l border-slate-800 space-y-0.5 mt-0.5">
              {item.children.map((child) => renderTreeNode(child, fullPath))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={fullPath}
        onClick={() => setSelectedFile({ ...item, fullPath })}
        className={`flex items-center justify-between py-1 px-2 rounded-md cursor-pointer text-xs transition-colors ${
          isSelected
            ? 'bg-indigo-600/20 text-indigo-300 font-medium'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          <FileCode className="h-3.5 w-3.5 text-slate-500" />
          <span className="truncate">{item.name}</span>
        </div>
        {item.size && (
          <span className="text-[10px] text-slate-500 font-mono ml-2">{item.size}</span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Back button and page header */}
      <div>
        <button
          onClick={() => navigate('/repositories')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Repositories</span>
        </button>

        <PageHeader
          title={repo.name}
          description={repo.description}
          badge={<StatusBadge status={repo.analysisStatus || 'Completed'} />}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={handleReanalyze}
                disabled={analyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${analyzing ? 'animate-spin text-indigo-400' : ''}`} />
                <span>{analyzing ? 'Analyzing...' : 'Re-analyze'}</span>
              </button>

              <button
                onClick={() => navigate(`/benchmarks/create?repoId=${repo.id}`)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
              >
                <Cpu className="h-4 w-4" />
                <span>Generate Benchmark</span>
              </button>
            </div>
          }
        />
      </div>

      {/* 8-Tab Navigation Bar */}
      <div className="border-b border-slate-800">
        <nav className="flex space-x-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 pb-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-indigo-500 text-white font-semibold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Files</span>
              <div className="mt-2 text-2xl font-bold font-mono text-white">{repo.stats?.fileCount || 248}</div>
              <div className="mt-1 text-xs text-slate-400">{repo.stats?.codeLines?.toLocaleString() || '34,200'} lines of code</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Primary Language</span>
              <div className="mt-2 text-2xl font-bold font-mono text-indigo-400">{repo.primaryLanguage}</div>
              <div className="mt-1 text-xs text-slate-400">Node / JavaScript runtime</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Package Size</span>
              <div className="mt-2 text-2xl font-bold font-mono text-white">{repo.stats?.sizeMb || 14.2} MB</div>
              <div className="mt-1 text-xs text-slate-400">Cloned git worktree</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-white">Repository Details</h3>
              <div className="divide-y divide-slate-800 text-xs">
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Source Type</span>
                  <span className="font-mono text-slate-200 capitalize">{repo.sourceType}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Source Reference</span>
                  <span className="font-mono text-indigo-400 truncate max-w-xs">{repo.sourceUrl}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Associated Project</span>
                  <span className="text-slate-200">{repo.projectName}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Active Branch</span>
                  <span className="font-mono text-slate-200">{repo.branch}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Analyzed Commit</span>
                  <span className="font-mono text-indigo-400">{repo.lastAnalyzedCommit}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Last Analyzed</span>
                  <span className="text-slate-200">{formatDate(repo.lastAnalyzed)}</span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
              <h3 className="text-sm font-semibold text-white">Detected Frameworks & Tech Stack</h3>
              <div className="flex flex-wrap gap-2">
                {(repo.frameworks || []).map((f) => (
                  <span key={f} className="px-3 py-1 rounded-lg bg-slate-800/80 text-xs font-medium text-slate-200 border border-slate-700">
                    {f}
                  </span>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Next Recommended Action</h4>
                <p className="text-xs text-slate-300">
                  Generate an AI-powered benchmark to discover feature opportunities and formulate structured coding evaluation tasks against this repository.
                </p>
                <button
                  onClick={() => navigate(`/benchmarks/create?repoId=${repo.id}`)}
                  className="w-full mt-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
                >
                  Launch Benchmark Discovery Wizard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FILE EXPLORER */}
      {activeTab === 'explorer' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 rounded-xl bg-[#0f172a] border border-slate-800 p-5">
          <div className="border-r border-slate-800 pr-4 overflow-y-auto max-h-[500px]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <FolderTree className="h-4 w-4 text-indigo-400" />
              Directory Tree
            </h3>
            <div className="space-y-0.5">
              {(repo.fileTree || []).map((item) => renderTreeNode(item))}
            </div>
          </div>

          <div className="md:col-span-2 pl-2 flex flex-col justify-between">
            {selectedFile ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-indigo-400" />
                    <span className="text-sm font-bold text-white">{selectedFile.fullPath || selectedFile.name}</span>
                  </div>
                  <span className="text-xs font-mono text-slate-400">{selectedFile.size || '3.4 KB'}</span>
                </div>

                <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 font-mono text-xs text-slate-300 space-y-2 max-h-[380px] overflow-y-auto">
                  <div className="text-slate-500">// Code preview for {selectedFile.name}</div>
                  <div className="text-indigo-300">// Indexed via TaskForge Code Intelligence Parser</div>
                  <pre className="text-slate-200">
{`/**
 * Module: ${selectedFile.name}
 * Repository: ${repo.name}
 * Status: Validated & Type-checked
 */

export function execute() {
  console.log("Analyzing ${selectedFile.name} AST components...");
  // Core business logic and model relationships
}
`}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <FileText className="h-10 w-10 text-slate-600 mb-2" />
                <p className="text-xs">Select any file from the explorer on the left to preview metadata and AST details.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: ARCHITECTURE (ON HOLD) */}
      {activeTab === 'architecture' && (
        <div className="space-y-4 rounded-xl bg-[#0f172a] border border-slate-800 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 mx-auto mb-3">
            <Network className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-white">Repository Architecture Graph (On Hold)</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            The automated AST architecture graph visualization is currently placed on hold while core repository APIs, data models, and benchmark evaluation flows are prioritized.
          </p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-amber-300">
            <span>Status: Feature temporarily paused</span>
          </div>
        </div>
      )}

      {/* TAB 4: APIS */}
      {activeTab === 'apis' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <SearchInput
              value={apiSearch}
              onChange={setApiSearch}
              placeholder="Search endpoints, controllers, modules..."
              className="w-full sm:w-80"
            />
            <select
              value={apiMethodFilter}
              onChange={(e) => setApiMethodFilter(e.target.value)}
              className="bg-[#0f172a] border border-slate-700 text-xs font-medium text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none"
            >
              <option value="all">All HTTP Methods</option>
              <option value="get">GET</option>
              <option value="post">POST</option>
              <option value="put">PUT</option>
              <option value="delete">DELETE</option>
            </select>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
                <tr>
                  <th className="py-2.5 px-4">Method</th>
                  <th className="py-2.5 px-4">Endpoint</th>
                  <th className="py-2.5 px-4">Handler</th>
                  <th className="py-2.5 px-4">Source File</th>
                  <th className="py-2.5 px-4 text-right">Module</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredApis.map((api, idx) => {
                  let badge = "bg-blue-500/10 text-blue-400 border-blue-500/30";
                  if (api.method === 'POST') badge = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                  if (api.method === 'PUT') badge = "bg-amber-500/10 text-amber-400 border-amber-500/30";
                  if (api.method === 'DELETE') badge = "bg-rose-500/10 text-rose-400 border-rose-500/30";

                  return (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge}`}>
                          {api.method}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white">{api.endpoint}</td>
                      <td className="py-3 px-4 text-indigo-300">{api.handler}()</td>
                      <td className="py-3 px-4 text-slate-400 font-sans text-xs">{api.sourceFile}</td>
                      <td className="py-3 px-4 text-right font-sans text-slate-300">{api.module}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: DATA MODELS */}
      {activeTab === 'models' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(repo.dataModels || []).map((model, idx) => (
            <div key={idx} className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-indigo-400" />
                  <h4 className="text-sm font-bold text-white">{model.name}</h4>
                </div>
                <span className="text-[10px] font-mono text-slate-400">{model.sourceFile}</span>
              </div>

              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
                  Fields
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(model.fields || []).map((f) => (
                    <span key={f} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              {model.relationships && model.relationships.length > 0 && (
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
                    Associations
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {model.relationships.map((rel) => (
                      <span key={rel} className="px-2 py-0.5 rounded bg-indigo-950/30 text-indigo-300 border border-indigo-800/40 text-[10px] font-mono">
                        {rel}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* TAB 6: DEPENDENCIES */}
      {activeTab === 'dependencies' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDepTypeFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                depTypeFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              All Packages
            </button>
            <button
              onClick={() => setDepTypeFilter('production')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                depTypeFilter === 'production' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              Production
            </button>
            <button
              onClick={() => setDepTypeFilter('development')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                depTypeFilter === 'development' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              Development
            </button>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
                <tr>
                  <th className="py-2.5 px-4">Package</th>
                  <th className="py-2.5 px-4">Version</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4 text-right">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredDeps.map((dep, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-bold text-white">{dep.package}</td>
                    <td className="py-3 px-4 text-indigo-300">{dep.version}</td>
                    <td className="py-3 px-4">
                      <span className="capitalize px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-sans">
                        {dep.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-sans text-slate-300">{dep.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
