import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  PlaySquare,
  ArrowLeft,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode2,
  Terminal,
  Trophy,
  Clock,
  Cpu,
  Layers,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
  Filter,
  Check
} from 'lucide-react';
import { formatDate, formatTimeAgo, formatDuration } from '../../lib/utils';

export const RunDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { runs, setRuns, cancelRun, addToast } = useApp();

  const run = runs.find((r) => r.id === id) || runs[0];

  // Simulation play/pause state
  const [isPlaying, setIsPlaying] = useState(run?.status === 'Running');
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'submissions' | 'evaluation'
  const [selectedAgentId, setSelectedAgentId] = useState(run?.agentExecutions?.[0]?.agentId || 'agent-antigravity');
  const [logFilterSeverity, setLogFilterSeverity] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const logsEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [run, autoScroll, selectedAgentId]);

  // Interactive Live Execution Simulation Interval
  useEffect(() => {
    let interval = null;
    if (isPlaying && run?.status === 'Running') {
      interval = setInterval(() => {
        setRuns((prevRuns) =>
          prevRuns.map((r) => {
            if (r.id !== run.id) return r;

            const stages = [
              'Workspace Preparation',
              'Repository Checkout',
              'Agent Initialization',
              'Repository Inspection',
              'Implementation',
              'Agent-Side Testing',
              'Submission Collection',
              'Evaluation Completed'
            ];

            let allFinished = true;

            const updatedAgents = (r.agentExecutions || []).map((agent) => {
              if (agent.status === 'Completed' || agent.status === 'Failed') {
                return agent;
              }

              const newProgress = Math.min(100, (agent.progress || 10) + Math.floor(Math.random() * 8) + 4);
              const stageIndex = Math.min(stages.length - 1, Math.floor((newProgress / 100) * stages.length));
              const currentStage = stages[stageIndex];
              const isFinished = newProgress >= 100;

              if (!isFinished) allFinished = false;

              // Append realistic live simulated logs
              const newLogs = [...(agent.logs || [])];
              const nowTime = new Date().toLocaleTimeString();

              if (newProgress > 25 && !newLogs.some((l) => l.message.includes('Indexed'))) {
                newLogs.push({ time: nowTime, level: 'info', message: 'Indexed 248 source files. Formulating dependency call graph.' });
              }
              if (newProgress > 50 && !newLogs.some((l) => l.message.includes('Synthesizing'))) {
                newLogs.push({ time: nowTime, level: 'info', message: 'Synthesizing controller implementation & validating schema migrations.' });
              }
              if (newProgress > 75 && !newLogs.some((l) => l.message.includes('Self-test'))) {
                newLogs.push({ time: nowTime, level: 'info', message: 'Executing agent self-test suite: 18 unit checks passing.' });
              }
              if (isFinished && !newLogs.some((l) => l.message.includes('Evaluation passed'))) {
                newLogs.push({ time: nowTime, level: 'info', message: 'Submission collected. Hidden test suite evaluated: 96% score.' });
              }

              return {
                ...agent,
                progress: newProgress,
                currentStage: isFinished ? 'Evaluation Completed' : currentStage,
                status: isFinished ? 'Completed' : 'Running',
                duration: (agent.duration || 100) + 15,
                score: isFinished ? (agent.score || Math.floor(Math.random() * 8 + 88)) : agent.score,
                logs: newLogs
              };
            });

            if (allFinished) {
              setIsPlaying(false);
            }

            return {
              ...r,
              status: allFinished ? 'Completed' : 'Running',
              agentExecutions: updatedAgents,
              bestPerformingAgent: 'Antigravity',
              highestScore: 94.2
            };
          })
        );
      }, 1500);
    }

    return () => clearInterval(interval);
  }, [isPlaying, run?.id, run?.status, setRuns]);

  const activeAgentExecution =
    run?.agentExecutions?.find((a) => a.agentId === selectedAgentId) ||
    run?.agentExecutions?.[0];

  const filteredLogs = (activeAgentExecution?.logs || []).filter((l) => {
    if (logFilterSeverity === 'all') return true;
    return l.level === logFilterSeverity;
  });

  return (
    <div className="space-y-6">
      {/* Back button and page header */}
      <div>
        <button
          onClick={() => navigate('/runs')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Benchmark Runner</span>
        </button>

        <PageHeader
          title={`Benchmark Execution #${run.id}`}
          description={`Target Benchmark: ${run.benchmarkName} • Repository: ${run.repositoryName}`}
          badge={<StatusBadge status={run.status} />}
          actions={
            <div className="flex items-center gap-2">
              {run.status === 'Running' ? (
                <>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5 text-amber-400" /> : <Play className="h-3.5 w-3.5 text-emerald-400" />}
                    <span>{isPlaying ? 'Pause Simulation' : 'Resume Simulation'}</span>
                  </button>

                  <button
                    onClick={() => cancelRun(run.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-300 hover:bg-rose-600 hover:text-white border border-rose-500/30 text-xs font-semibold transition-colors"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Cancel Run</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate(`/results/${run.id === 'run-101' ? 'eval-101' : 'eval-101'}`)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
                >
                  <Trophy className="h-4 w-4" />
                  <span>View Detailed Evaluation Report</span>
                </button>
              )}
            </div>
          }
        />
      </div>

      {/* Overview Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Environment</span>
          <div className="mt-1 text-sm font-bold text-white truncate">{run.runtimeEnvironment}</div>
          <div className="mt-1 text-xs text-slate-400">{run.resourceLimits?.cpu} • {run.resourceLimits?.memory}</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Duration</span>
          <div className="mt-1 text-lg font-bold font-mono text-white">
            {formatDuration(run.totalDuration || 640)}
          </div>
          <div className="mt-1 text-xs text-slate-400">Started {formatTimeAgo(run.startedAt)}</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Top Performing Agent</span>
          <div className="mt-1 text-sm font-bold text-indigo-400">{run.bestPerformingAgent || 'Evaluating...'}</div>
          <div className="mt-1 text-xs text-slate-400">Leading benchmark score</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Highest Score</span>
          <div className="mt-1 text-2xl font-bold font-mono text-emerald-400">
            {run.highestScore !== '--' ? `${run.highestScore}%` : '--'}
          </div>
          <div className="mt-1 text-xs text-slate-400">Provisional weighted score</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab('live')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'live'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="h-4 w-4" />
            <span>Agent Execution Cards & Live Logs</span>
          </button>

          <button
            onClick={() => setActiveTab('submissions')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'submissions'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="h-4 w-4" />
            <span>Code Submissions & Diffs</span>
          </button>

          <button
            onClick={() => setActiveTab('evaluation')}
            className={`pb-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'evaluation'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Evaluation Breakdown & Hidden Tests</span>
          </button>
        </nav>
      </div>

      {/* TAB 1: LIVE AGENT EXECUTION CARDS & LOG TERMINAL */}
      {activeTab === 'live' && (
        <div className="space-y-6">
          {/* 8.5 Agent Execution Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(run.agentExecutions || []).map((agent) => {
              const isSelected = selectedAgentId === agent.agentId;
              return (
                <div
                  key={agent.agentId}
                  onClick={() => setSelectedAgentId(agent.agentId)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-indigo-950/25 border-indigo-500 ring-1 ring-indigo-500 shadow-xl'
                      : 'bg-[#0f172a] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-white">{agent.agentName}</h4>
                        <span className="text-[10px] text-slate-400">{agent.provider}</span>
                      </div>
                      <StatusBadge status={agent.status} />
                    </div>

                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] mb-1 font-mono">
                        <span className="text-slate-400 truncate max-w-[130px]">{agent.currentStage}</span>
                        <span className="text-indigo-400 font-bold">{agent.progress || 100}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                          style={{ width: `${agent.progress || 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Duration: <strong className="font-mono text-slate-200">{formatDuration(agent.duration || 440)}</strong></span>
                    {agent.score && (
                      <span className="text-emerald-400 font-bold font-mono">{agent.score}% Score</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Log Terminal with Filtering and Auto-scroll */}
          <div className="rounded-xl bg-[#0b0f17] border border-slate-800 overflow-hidden shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-2.5 bg-[#0e1422] border-b border-slate-800 gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-indigo-400" />
                <span className="text-xs font-bold text-white font-mono">
                  {activeAgentExecution?.agentName || 'Agent'} — Execution Console
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                  Stage: {activeAgentExecution?.currentStage}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                {/* Severity Filter */}
                <select
                  value={logFilterSeverity}
                  onChange={(e) => setLogFilterSeverity(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-[11px] text-slate-300 rounded px-2 py-1 focus:outline-none"
                >
                  <option value="all">All Severities</option>
                  <option value="info">Info</option>
                  <option value="warn">Warnings</option>
                  <option value="error">Errors</option>
                </select>

                {/* Auto Scroll Toggle */}
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Auto-scroll</span>
                </label>
              </div>
            </div>

            {/* Terminal Body */}
            <div className="p-4 font-mono text-xs text-slate-300 space-y-1.5 h-80 overflow-y-auto">
              {filteredLogs.length === 0 ? (
                <div className="text-slate-500 py-8 text-center">No logs recorded for this severity filter.</div>
              ) : (
                filteredLogs.map((log, idx) => {
                  let color = "text-slate-300";
                  if (log.level === 'warn') color = "text-amber-400";
                  if (log.level === 'error') color = "text-rose-400";

                  return (
                    <div key={idx} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-slate-600 select-none">[{log.time}]</span>
                      <span className={`text-[10px] uppercase font-bold select-none ${
                        log.level === 'warn' ? 'text-amber-500' : log.level === 'error' ? 'text-rose-500' : 'text-indigo-400'
                      }`}>
                        [{log.level}]
                      </span>
                      <span className={color}>{log.message}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CODE SUBMISSION REVIEW & DIFFS */}
      {activeTab === 'submissions' && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Agent Submissions & Patches</h3>
              <p className="text-xs text-slate-400">Review git patch commits produced by each agent before hidden test evaluation</p>
            </div>

            {/* Agent Selector */}
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="bg-[#111827] border border-slate-700 text-xs font-semibold text-white rounded-lg px-3 py-1.5 focus:outline-none"
            >
              {(run.agentExecutions || []).map((a) => (
                <option key={a.agentId} value={a.agentId}>{a.agentName}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border-r border-slate-800 pr-4 space-y-3 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Changed Files ({activeAgentExecution?.submission?.modifiedFiles?.length || 2} modified, {activeAgentExecution?.submission?.addedFiles?.length || 3} added)
              </span>

              <div className="space-y-1 font-mono">
                {(activeAgentExecution?.submission?.addedFiles || ['server/models/Coupon.js', 'server/controllers/couponController.js']).map((f) => (
                  <div key={f} className="p-2 rounded bg-emerald-950/20 text-emerald-300 border border-emerald-900/40 flex justify-between">
                    <span className="truncate">{f}</span>
                    <span className="text-[10px] font-sans">ADDED</span>
                  </div>
                ))}
                {(activeAgentExecution?.submission?.modifiedFiles || ['server/controllers/cartController.js']).map((f) => (
                  <div key={f} className="p-2 rounded bg-amber-950/20 text-amber-300 border border-amber-900/40 flex justify-between">
                    <span className="truncate">{f}</span>
                    <span className="text-[10px] font-sans">MODIFIED</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 font-mono text-xs space-y-1 overflow-x-auto max-h-[380px]">
                <div className="text-slate-500">@@ -0,0 +1,24 @@</div>
                <div className="text-emerald-400">{"+ exports.applyCoupon = async (req, res) => {"}</div>
                <div className="text-emerald-400">{"+   const { code, cartId } = req.body;"}</div>
                <div className="text-emerald-400">{"+   const coupon = await Coupon.findOne({ where: { code: code.toUpperCase(), active: true } });"}</div>
                <div className="text-emerald-400">{"+   if (!coupon) return res.status(404).json({ error: 'COUPON_NOT_FOUND' });"}</div>
                <div className="text-emerald-400">{"+   return res.json({ success: true, discountAmount: coupon.discount });"}</div>
                <div className="text-emerald-400">{"+ };"}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: EVALUATION PROGRESS */}
      {activeTab === 'evaluation' && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white">Independent Benchmark Evaluation Phase</h3>
              <p className="text-xs text-slate-400">Hidden feature tests and baseline regression verification run in clean Docker sandboxes</p>
            </div>
            <button
              onClick={() => navigate('/results/eval-101')}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
            >
              Open Complete Results Report
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-xs font-bold text-white">1. Functional Feature Tests (Hidden)</span>
              <p className="text-xs text-slate-400">22 assertions executed against agent submission without agent awareness.</p>
              <div className="pt-2 text-xs font-mono text-emerald-400 font-bold">21 of 22 Passed (95.4%)</div>
            </div>

            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-xs font-bold text-white">2. Regression Test Safety</span>
              <p className="text-xs text-slate-400">Existing 86 test cases executed to verify zero baseline regressions.</p>
              <div className="pt-2 text-xs font-mono text-emerald-400 font-bold">84 of 86 Passed (97.6%)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
