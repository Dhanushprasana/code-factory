import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  Cpu,
  ArrowLeft,
  PlaySquare,
  GitBranch,
  FileText,
  Code2,
  EyeOff,
  ShieldCheck,
  History,
  Copy,
  Archive,
  ExternalLink,
  CheckCircle2,
  Clock,
  Layers
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const BenchmarkDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { benchmarks, repositories, runs, addToast } = useApp();

  const bench = benchmarks.find((b) => b.id === id) || benchmarks[0];
  const [activeTab, setActiveTab] = useState('overview');

  const benchRuns = runs.filter((r) => r.benchmarkId === bench.id);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'spec', label: 'Task Specification' },
    { key: 'repo', label: 'Repository Context' },
    { key: 'solution', label: 'Reference Solution' },
    { key: 'tests', label: 'Hidden Tests' },
    { key: 'validation', label: 'Validation Report' },
    { key: 'versions', label: 'Versions' },
    { key: 'history', label: `Execution History (${benchRuns.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Back button and page header */}
      <div>
        <button
          onClick={() => navigate('/benchmarks')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Benchmark Factory</span>
        </button>

        <PageHeader
          title={bench.name}
          description={`Target Repository: ${bench.repositoryName} • Category: ${bench.featureCategory} • Complexity: ${bench.complexity}`}
          badge={<StatusBadge status={bench.status} />}
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  addToast({
                    title: 'Benchmark Duplicated',
                    message: `Created duplicate draft of "${bench.name}".`,
                    type: 'info'
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Duplicate</span>
              </button>

              <button
                onClick={() => navigate(`/runs?benchmarkId=${bench.id}`)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
              >
                <PlaySquare className="h-4 w-4" />
                <span>Launch in Benchmark Runner</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-slate-800">
        <nav className="flex space-x-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
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

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Complexity</span>
              <div className="mt-2 text-2xl font-bold font-mono text-indigo-400">{bench.complexity}</div>
              <div className="mt-1 text-xs text-slate-400">{bench.featureCategory} Domain</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Executions</span>
              <div className="mt-2 text-2xl font-bold font-mono text-white">{bench.executionCount || benchRuns.length}</div>
              <div className="mt-1 text-xs text-slate-400">Agent runs recorded</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Active Version</span>
              <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">{bench.version}</div>
              <div className="mt-1 text-xs text-slate-400">Published release</div>
            </div>

            <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Starting Commit</span>
              <div className="mt-2 text-2xl font-bold font-mono text-white">{bench.taskSpecification?.startingCommitSha || 'c4a9f21'}</div>
              <div className="mt-1 text-xs text-slate-400">Clean git checkout SHA</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-white">Benchmark Metadata</h3>
              <div className="divide-y divide-slate-800 text-xs">
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Benchmark ID</span>
                  <span className="font-mono text-slate-200">{bench.id}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Target Repository</span>
                  <span className="font-medium text-indigo-300">{bench.repositoryName}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Project Workspace</span>
                  <span className="text-slate-200">{bench.projectName}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Created Date</span>
                  <span className="text-slate-200">{formatDate(bench.createdDate)}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-400">Validation Status</span>
                  <StatusBadge status={bench.validationReport?.passedChecks === 8 ? 'Passed' : 'Warning'} />
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-white">Problem Statement Summary</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {bench.taskSpecification?.problemStatement || 'No problem statement defined.'}
              </p>
              <div className="pt-3 border-t border-slate-800">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Acceptance Highlights</h4>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {(bench.taskSpecification?.acceptanceCriteria || []).slice(0, 3).map((crit, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{crit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TASK SPECIFICATION */}
      {activeTab === 'spec' && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-6">
          <div className="pb-3 border-b border-slate-800">
            <h3 className="text-base font-bold text-white">{bench.taskSpecification?.title}</h3>
            <p className="text-xs text-slate-400 mt-1">Starting baseline commit: <span className="font-mono text-indigo-400">{bench.taskSpecification?.startingCommitSha}</span></p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <h4 className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Feature Description</h4>
              <p className="text-slate-200 leading-relaxed bg-[#111827] p-3 rounded-lg border border-slate-800">
                {bench.taskSpecification?.featureDescription}
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Functional Requirements</h4>
              <ul className="space-y-1.5 bg-[#111827] p-3 rounded-lg border border-slate-800">
                {(bench.taskSpecification?.functionalRequirements || []).map((req, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-200">
                    <span className="font-mono text-indigo-400">•</span>
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Acceptance Criteria</h4>
              <ul className="space-y-1.5 bg-[#111827] p-3 rounded-lg border border-slate-800">
                {(bench.taskSpecification?.acceptanceCriteria || []).map((crit, i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-200">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{crit}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#111827] p-3 rounded-lg border border-slate-800">
                <h4 className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Technical Constraints</h4>
                <p className="text-slate-200">{bench.taskSpecification?.technicalConstraints}</p>
              </div>
              <div className="bg-[#111827] p-3 rounded-lg border border-slate-800">
                <h4 className="font-semibold text-slate-400 uppercase tracking-wider mb-1">Edge Cases</h4>
                <p className="text-slate-200">{bench.taskSpecification?.edgeCases}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REPOSITORY CONTEXT */}
      {activeTab === 'repo' && (
        <div className="p-6 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Repository Baseline Snapshot</h3>
            <button
              onClick={() => navigate(`/repositories/${bench.repositoryId}`)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <span>Open Repository View</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Agents executing this benchmark will be provisioned in a clean container cloned from <strong>{bench.repositoryName}</strong> at commit <strong>{bench.taskSpecification?.startingCommitSha || 'c4a9f21'}</strong>.
          </p>
        </div>
      )}

      {/* TAB 4: REFERENCE SOLUTION */}
      {activeTab === 'solution' && (
        <div className="p-6 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Reference Solution Ground Truth</h3>
              <p className="text-xs text-slate-400">{bench.referenceImplementation?.summary}</p>
            </div>
            <StatusBadge status="Ready" />
          </div>

          <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 font-mono text-xs text-slate-300">
            <div className="text-slate-500">// Reference diff verified against test suite</div>
            <div className="text-emerald-400">+ server/models/Coupon.js</div>
            <div className="text-emerald-400">+ server/controllers/couponController.js</div>
            <div className="text-amber-400">~ server/controllers/cartController.js</div>
            <div className="text-amber-400">~ src/components/CartDrawer.jsx</div>
          </div>
        </div>
      )}

      {/* TAB 5: HIDDEN TESTS */}
      {activeTab === 'tests' && (
        <div className="p-6 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">{bench.hiddenTests?.testSuiteName || 'Hidden Test Suite'}</h3>
              <p className="text-xs text-slate-400">Total hidden assertions: {bench.hiddenTests?.testCount || 22} test cases</p>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              <span>Isolated From Agents</span>
            </span>
          </div>

          <div className="divide-y divide-slate-800 text-xs">
            {(bench.hiddenTests?.testCases || []).map((tc, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between">
                <span className="text-slate-200">{tc.name}</span>
                <span className="font-mono text-emerald-400">Verified</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: VALIDATION REPORT */}
      {activeTab === 'validation' && (
        <div className="p-6 rounded-xl bg-[#0f172a] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Benchmark Validation Dashboard</h3>
            <span className="text-xs font-mono font-bold text-emerald-400">100% Passed</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(bench.validationReport?.checks || []).map((chk, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h5 className="font-bold text-white">{chk.name}</h5>
                  <p className="text-slate-400 text-[11px] mt-0.5">{chk.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: VERSIONS */}
      {activeTab === 'versions' && (
        <div className="p-6 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
          <h3 className="text-sm font-semibold text-white">Benchmark Releases & Versions</h3>
          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <span className="font-bold font-mono text-white">{bench.version} (Active)</span>
              <p className="text-slate-400 text-[11px]">Published release for runner execution</p>
            </div>
            <span className="text-slate-400 font-mono">{formatDate(bench.createdDate)}</span>
          </div>
        </div>
      )}

      {/* TAB 8: EXECUTION HISTORY */}
      {activeTab === 'history' && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
              <tr>
                <th className="py-2.5 px-4">Run ID</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Top Agent</th>
                <th className="py-2.5 px-4 text-right">Score</th>
                <th className="py-2.5 px-4 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {benchRuns.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/runs/${r.id}`)}
                  className="hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="py-3 px-4 font-bold text-indigo-400">{r.id}</td>
                  <td className="py-3 px-4 font-sans"><StatusBadge status={r.status} /></td>
                  <td className="py-3 px-4 font-sans text-white">{r.bestPerformingAgent}</td>
                  <td className="py-3 px-4 text-right text-emerald-400 font-bold">{r.highestScore}%</td>
                  <td className="py-3 px-4 text-right text-slate-400 font-sans">{formatTimeAgo(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
