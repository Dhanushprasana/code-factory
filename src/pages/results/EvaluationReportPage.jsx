import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  Trophy,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode2,
  GitBranch,
  ShieldCheck,
  Clock,
  Terminal,
  UserCheck,
  Save,
  Layers,
  ChevronRight,
  ExternalLink,
  Code2,
  Sparkles
} from 'lucide-react';
import { formatDate, formatTimeAgo } from '../../lib/utils';

export const EvaluationReportPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { evaluations, submitHumanReview, addToast } = useApp();

  const report = evaluations.find((e) => e.id === id) || evaluations[0];
  const [selectedAgentId, setSelectedAgentId] = useState('agent-antigravity');

  // Human review form state
  const [humanReviewState, setHumanReviewState] = useState({
    reviewer: report?.humanReview?.reviewer || 'Gary Chen (Principal Benchmark Architect)',
    status: report?.humanReview?.status || 'Approved',
    confidenceScore: report?.humanReview?.confidenceScore || 5,
    assessment: report?.humanReview?.assessment || 'Antigravity demonstrated superior architectural restraint and complete transaction atomicity.',
    recommendations: report?.humanReview?.recommendations || 'Recommended for production benchmark baseline.',
  });

  const handleSaveReview = (e) => {
    e.preventDefault();
    submitHumanReview(report.id, humanReviewState);
  };

  const agentResults = report.agentResults || [];
  const selectedAgentResult =
    agentResults.find((a) => a.agentId === selectedAgentId) || agentResults[0];

  return (
    <div className="space-y-6">
      {/* Back button and page header */}
      <div>
        <button
          onClick={() => navigate('/results')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Evaluation Results</span>
        </button>

        <PageHeader
          title={`Evaluation Report #${report.id}`}
          description={`Comprehensive automated benchmark evaluation for "${report.benchmarkName}" against repository ${report.repositoryName}.`}
          badge={<StatusBadge status={report.status} />}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                Winner: {report.winningAgent} ({report.highestScore}%)
              </span>
            </div>
          }
        />
      </div>

      {/* 9.4 Run Summary Card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Target Benchmark</span>
          <div className="mt-1 text-sm font-bold text-white truncate">{report.benchmarkName}</div>
          <div className="mt-1 text-xs text-slate-400">Package: v1.2.0 (Ready)</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Repository & Commit</span>
          <div className="mt-1 text-sm font-bold text-white truncate">{report.repositoryName}</div>
          <div className="mt-1 text-xs text-indigo-400 font-mono">commit c4a9f21</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Agents Graded</span>
          <div className="mt-1 text-2xl font-bold font-mono text-white">{report.agentsEvaluated}</div>
          <div className="mt-1 text-xs text-slate-400">Parallel container sandboxes</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0f172a] border border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Evaluated On</span>
          <div className="mt-1 text-sm font-bold text-slate-200">{formatDate(report.date)}</div>
          <div className="mt-1 text-xs text-slate-400">{formatTimeAgo(report.date)}</div>
        </div>
      </div>

      {/* 9.4 Agent Comparison Table */}
      <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Head-to-Head Agent Comparison</h3>
            <p className="text-xs text-slate-400">Overall score, hidden feature tests, regression tests, and total completion time</p>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">Simulated Dataset</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/60 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-4">Rank & Agent</th>
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4 text-right">Overall Score</th>
                <th className="py-3 px-4 text-right">Feature Tests (60%)</th>
                <th className="py-3 px-4 text-right">Regression Safety (25%)</th>
                <th className="py-3 px-4 text-right">Execution Time</th>
                <th className="py-3 px-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {agentResults.map((agent) => (
                <tr
                  key={agent.agentId}
                  onClick={() => setSelectedAgentId(agent.agentId)}
                  className={`hover:bg-slate-800/50 cursor-pointer transition-colors ${
                    selectedAgentId === agent.agentId ? 'bg-indigo-950/25' : ''
                  }`}
                >
                  <td className="py-3.5 px-4 font-sans font-bold text-white flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-mono text-indigo-400">
                      {agent.rank}
                    </span>
                    <span>{agent.agentName}</span>
                  </td>

                  <td className="py-3.5 px-4 font-sans text-slate-300">
                    {agent.provider}
                  </td>

                  <td className="py-3.5 px-4 text-right font-bold text-base text-emerald-400">
                    {agent.overallScore}%
                  </td>

                  <td className="py-3.5 px-4 text-right text-indigo-300">
                    {agent.featurePassRate}%
                  </td>

                  <td className="py-3.5 px-4 text-right text-slate-300">
                    {agent.regressionPassRate}%
                  </td>

                  <td className="py-3.5 px-4 text-right text-slate-400">
                    {agent.executionTime}
                  </td>

                  <td className="py-3.5 px-4 text-right font-sans">
                    <button
                      onClick={() => setSelectedAgentId(agent.agentId)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      View Details →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 9.4 Detailed Selected Agent Inspection */}
      {selectedAgentResult && (
        <div className="space-y-6 rounded-xl bg-[#0f172a] border border-slate-800 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-800 gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white">
                  Inspection: {selectedAgentResult.agentName}
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  Rank #{selectedAgentResult.rank}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Detailed score breakdown, test assertions, code diff, and failure analysis
              </p>
            </div>

            <div className="text-right">
              <span className="text-2xl font-bold font-mono text-emerald-400">
                {selectedAgentResult.overallScore}%
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">Weighted Composite Score</span>
            </div>
          </div>

          {/* 9.4 Score Breakdown Component (Provisional Weights) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Provisional Scoring Model Breakdown
              </h4>
              <span className="text-[10px] text-amber-400 font-mono">
                * Configurable Weighted Model
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Functional Correctness</span>
                  <span className="font-mono text-indigo-400">60%</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {selectedAgentResult.scoreComponents?.functionalCorrectness?.raw || 96}%
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Contribution: +{(selectedAgentResult.scoreComponents?.functionalCorrectness?.weighted || 57.6).toFixed(1)} pts
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Regression Safety</span>
                  <span className="font-mono text-indigo-400">25%</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {selectedAgentResult.scoreComponents?.regressionSafety?.raw || 98}%
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Contribution: +{(selectedAgentResult.scoreComponents?.regressionSafety?.weighted || 24.5).toFixed(1)} pts
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Code Quality</span>
                  <span className="font-mono text-indigo-400">10%</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {selectedAgentResult.scoreComponents?.codeQuality?.raw || 92}%
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Contribution: +{(selectedAgentResult.scoreComponents?.codeQuality?.weighted || 9.2).toFixed(1)} pts
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Execution Reliability</span>
                  <span className="font-mono text-indigo-400">5%</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {selectedAgentResult.scoreComponents?.executionReliability?.raw || 95}%
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Contribution: +{(selectedAgentResult.scoreComponents?.executionReliability?.weighted || 4.75).toFixed(1)} pts
                </div>
              </div>
            </div>
          </div>

          {/* Test Results & Acceptance Criteria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Test Suite Summary
              </span>
              <div className="grid grid-cols-3 gap-2 text-center pt-1 font-mono">
                <div className="p-2 rounded bg-slate-800">
                  <div className="text-white font-bold">{selectedAgentResult.tests?.total || 108}</div>
                  <div className="text-[9px] uppercase text-slate-400">Total</div>
                </div>
                <div className="p-2 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-900/40">
                  <div className="font-bold">{selectedAgentResult.tests?.passed || 105}</div>
                  <div className="text-[9px] uppercase text-emerald-300">Passed</div>
                </div>
                <div className="p-2 rounded bg-rose-950/40 text-rose-400 border border-rose-950/40">
                  <div className="font-bold">{selectedAgentResult.tests?.failed || 3}</div>
                  <div className="text-[9px] uppercase text-rose-300">Failed</div>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Acceptance Criteria Coverage
              </span>
              <div className="text-emerald-400 font-bold font-mono text-sm pt-1">
                {selectedAgentResult.tests?.acceptanceCriteriaMet || '5 of 5 met (100%)'}
              </div>
              <p className="text-slate-400 text-[11px]">
                Agent satisfied all functional acceptance criteria without test leakages.
              </p>
            </div>
          </div>

          {/* Code Change Inspection & Side-by-Side Diff */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Code Change Diff & Patch Inspection
            </h4>
            <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 font-mono text-xs space-y-1 overflow-x-auto max-h-[300px]">
              <div className="text-slate-500">--- a/server/controllers/couponController.js</div>
              <div className="text-slate-500">+++ b/server/controllers/couponController.js</div>
              <div className="text-emerald-400">{"+ const { Coupon, Cart } = require('../models');"}</div>
              <div className="text-emerald-400">{"+ exports.applyCoupon = async (req, res) => {"}</div>
              <div className="text-emerald-400">{"+   const { code, cartId } = req.body;"}</div>
              <div className="text-emerald-400">{"+   const coupon = await Coupon.findOne({ where: { code: code.toUpperCase() } });"}</div>
              <div className="text-emerald-400">{"+   if (!coupon) return res.status(404).json({ error: 'COUPON_NOT_FOUND' });"}</div>
              <div className="text-emerald-400">{"+   return res.json({ success: true, discountAmount: coupon.discountAmount });"}</div>
              <div className="text-emerald-400">{"+ };"}</div>
            </div>
          </div>

          {/* Failure Analysis */}
          {selectedAgentResult.failureAnalysis && (
            <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2 text-xs">
              <h4 className="font-semibold text-rose-400 uppercase tracking-wider text-[11px]">
                Failure & Warning Analysis
              </h4>
              {selectedAgentResult.failureAnalysis.failedCriteria?.length > 0 ? (
                <ul className="space-y-1 text-rose-300">
                  {selectedAgentResult.failureAnalysis.failedCriteria.map((c, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <XCircle className="h-3.5 w-3.5" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-400">Zero critical acceptance criteria failures detected.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 9.4 Human Review Assessment Form */}
      <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-bold text-white">Architect Human Review</h3>
              <p className="text-xs text-slate-400">Manual engineering assessment archived alongside automated scoring</p>
            </div>
          </div>
          <StatusBadge status={humanReviewState.status} />
        </div>

        <form onSubmit={handleSaveReview} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Reviewer Name
              </label>
              <input
                type="text"
                value={humanReviewState.reviewer}
                onChange={(e) => setHumanReviewState({ ...humanReviewState, reviewer: e.target.value })}
                className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Review Decision
              </label>
              <select
                value={humanReviewState.status}
                onChange={(e) => setHumanReviewState({ ...humanReviewState, status: e.target.value })}
                className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="Approved">Approved</option>
                <option value="Needs Revision">Needs Revision</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Confidence Score (1-5)
              </label>
              <select
                value={humanReviewState.confidenceScore}
                onChange={(e) => setHumanReviewState({ ...humanReviewState, confidenceScore: Number(e.target.value) })}
                className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="5">5 - Exceptional Quality</option>
                <option value="4">4 - High Confidence</option>
                <option value="3">3 - Moderate</option>
                <option value="2">2 - Low Confidence</option>
                <option value="1">1 - Failed Criteria</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Architect Assessment & Notes
            </label>
            <textarea
              rows={3}
              value={humanReviewState.assessment}
              onChange={(e) => setHumanReviewState({ ...humanReviewState, assessment: e.target.value })}
              className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
            >
              <Save className="h-4 w-4" />
              <span>Save Human Review</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
