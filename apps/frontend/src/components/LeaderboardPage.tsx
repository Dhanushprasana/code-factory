import { useEffect, useMemo, useState } from 'react';
import { Play, RefreshCw, Trophy } from 'lucide-react';

export interface HarborAgentSummary {
  id: string;
  name: string;
  provider: string;
  adapterType: string;
  modelName: string | null;
  status: string;
  settings?: Record<string, any> | null;
}

export interface HarborPackageItem {
  packageId: string;
  taskId: string;
  taskVersion: number;
  title: string;
  category: string;
  difficulty: string;
  status: string;
  fileCount: number;
  createdAt: string;
}

export interface HarborRunEntry {
  id: string;
  jobId: string;
  agentId: string;
  agentName: string;
  provider: string;
  harborAgent: string;
  modelName: string;
  packageId: string | null;
  taskTitle: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  passedTasks: number;
  totalTasks: number;
  score: number;
  durationSeconds: number;
  startedAt: string;
  finishedAt?: string | null;
  error?: string | null;
}

export function LeaderboardPage({
  apiUrl,
}: {
  apiUrl: string;
}) {
  const [agents, setAgents] = useState<HarborAgentSummary[]>([]);
  const [packages, setPackages] = useState<HarborPackageItem[]>([]);
  const [runs, setRuns] = useState<HarborRunEntry[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [selectedPackageId, setSelectedPackageId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [runningRequest, setRunningRequest] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [agentsRes, packagesRes, runsRes] = await Promise.all([
        fetch(`${apiUrl}/agents`).then(r => (r.ok ? r.json() : [])),
        fetch(`${apiUrl}/harbor-packages`).then(r => (r.ok ? r.json() : [])),
        fetch(`${apiUrl}/harbor/runs`).then(r => (r.ok ? r.json() : [])),
      ]);
      setAgents(Array.isArray(agentsRes) ? agentsRes : []);
      setPackages(Array.isArray(packagesRes) ? packagesRes : []);
      setRuns(Array.isArray(runsRes) ? runsRes : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load leaderboard data.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [apiUrl]);

  useEffect(() => {
    if (!runs.some(r => r.status === 'running' || r.status === 'queued')) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadData(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runs, apiUrl]);

  const handleRunHarbor = async (agentIdOverride?: string) => {
    setError('');
    setNotice('');
    setRunningRequest(true);
    const targetId = agentIdOverride ?? selectedAgentId;
    try {
      const res = await fetch(`${apiUrl}/harbor/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: targetId,
          packageId: selectedPackageId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.message ?? `Failed to start Harbor run (${res.status}).`);
      }
      const started = Array.isArray(body) ? (body as HarborRunEntry[]) : [];
      setRuns(prev => [...started, ...prev]);
      setNotice(
        targetId === 'all'
          ? `Started Harbor evaluation across ${started.length} ready agent(s).`
          : `Started Harbor evaluation for "${started[0]?.agentName ?? 'selected agent'}".`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start Harbor run.');
    } finally {
      setRunningRequest(false);
    }
  };

  const leaderboardRows = useMemo(() => {
    const byAgent = new Map<string, {
      agent: HarborAgentSummary;
      totalRuns: number;
      passedRuns: number;
      avgScore: number;
      avgDuration: number;
      lastStatus: string;
    }>();

    for (const agent of agents) {
      const agentRuns = runs.filter(r => r.agentId === agent.id);
      const completed = agentRuns.filter(r => r.status === 'passed' || r.status === 'failed');
      const passed = agentRuns.filter(r => r.status === 'passed');
      const avgScore = completed.length
        ? Math.round(completed.reduce((acc, r) => acc + r.score, 0) / completed.length)
        : 0;
      const avgDuration = completed.length
        ? Math.round(completed.reduce((acc, r) => acc + r.durationSeconds, 0) / completed.length)
        : 0;
      byAgent.set(agent.id, {
        agent,
        totalRuns: agentRuns.length,
        passedRuns: passed.length,
        avgScore,
        avgDuration,
        lastStatus: agentRuns[0]?.status ?? 'not_run',
      });
    }

    return [...byAgent.values()].sort((a, b) => {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      if (b.passedRuns !== a.passedRuns) return b.passedRuns - a.passedRuns;
      return a.agent.name.localeCompare(b.agent.name);
    });
  }, [agents, runs]);

  const readyCount = agents.filter(a => a.status === 'ready').length;
  const topScore = leaderboardRows[0]?.avgScore ?? 0;

  return (
    <div className="page leaderboard-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Harbor Benchmark</span>
          <h1>Agent Leaderboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="secondary-button" onClick={() => loadData()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => handleRunHarbor('all')}
            disabled={readyCount === 0 || packages.length === 0 || runningRequest}
          >
            <Play size={15} /> {runningRequest ? 'Starting…' : 'Run Harbor (All Ready Agents)'}
          </button>
        </div>
      </div>

      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}

      <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="metric-card">
          <span>Registered Agents</span>
          <strong>{agents.length}</strong>
          <small>{readyCount} ready for Harbor</small>
        </div>
        <div className="metric-card">
          <span>Harbor Runs</span>
          <strong>{runs.length}</strong>
          <small>Persisted in Harbor volume</small>
        </div>
        <div className="metric-card">
          <span>Top Pass Rate</span>
          <strong style={{ color: '#247044' }}>{topScore}%</strong>
          <small>Highest average score</small>
        </div>
        <div className="metric-card">
          <span>Finalized Packages</span>
          <strong>{packages.length}</strong>
          <small>Ready Harbor packages</small>
        </div>
      </div>

      <section className="panel harbor-launcher-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Execution Control</span>
            <h2>Run Harbor Evaluation</h2>
          </div>
        </div>
        <div className="harbor-launcher-controls">
          <label>
            Target Agent
            <select value={selectedAgentId} onChange={e => setSelectedAgentId(e.target.value)}>
              <option value="all">All Ready Agents ({readyCount})</option>
              {agents.map(agent => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.provider} · {agent.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            Harbor Package
            <select value={selectedPackageId} onChange={e => setSelectedPackageId(e.target.value)}>
              <option value="all">All Finalized Packages ({packages.length})</option>
              {packages.map(pkg => (
                <option key={pkg.packageId} value={pkg.packageId}>
                  {pkg.title} ({pkg.packageId})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={() => handleRunHarbor()}
            disabled={agents.length === 0 || packages.length === 0 || runningRequest}
          >
            <Play size={15} /> {runningRequest ? 'Starting…' : 'Run Harbor'}
          </button>
        </div>
      </section>

      <section className="panel leaderboard-table-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Standings</span>
            <h2><Trophy size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />Harbor Agent Rankings</h2>
          </div>
        </div>

        {loading ? (
          <div className="empty-state compact">Loading leaderboard…</div>
        ) : leaderboardRows.length === 0 ? (
          <div className="empty-state compact">
            No agents registered yet. Register agents in Settings to appear on the leaderboard.
          </div>
        ) : (
          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Harbor Agent</th>
                  <th>Runs</th>
                  <th>Pass Rate</th>
                  <th>Avg Duration</th>
                  <th>Last Run</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row, idx) => (
                  <tr key={row.agent.id}>
                    <td><strong>#{idx + 1}</strong></td>
                    <td>
                      <div className="leaderboard-agent-cell">
                        <strong>{row.agent.name}</strong>
                        <small>{row.agent.provider}</small>
                      </div>
                    </td>
                    <td><code>{row.agent.modelName || 'unassigned'}</code></td>
                    <td><span className="tag-badge adapter">{row.agent.settings?.harborAgent || row.agent.adapterType}</span></td>
                    <td>{row.passedRuns} / {row.totalRuns}</td>
                    <td>
                      <div className="leaderboard-score-cell">
                        <div className="leaderboard-score-bar">
                          <div style={{ width: `${row.avgScore}%` }} />
                        </div>
                        <span>{row.avgScore}%</span>
                      </div>
                    </td>
                    <td>{row.avgDuration ? `${row.avgDuration}s` : '—'}</td>
                    <td>
                      <span className={`status ${row.lastStatus === 'passed' ? 'green' : row.lastStatus === 'failed' ? 'amber' : 'gray'}`}>
                        {row.lastStatus.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        disabled={packages.length === 0 || runningRequest}
                        onClick={() => handleRunHarbor(row.agent.id)}
                      >
                        <Play size={12} /> Run Harbor
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section className="panel leaderboard-runs-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">History</span>
              <h2>Recent Harbor Runs</h2>
            </div>
          </div>
          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Package / Task</th>
                  <th>Score</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 20).map(run => (
                  <tr key={run.id}>
                    <td><strong>{run.agentName}</strong></td>
                    <td><code>{run.modelName}</code></td>
                    <td>{run.taskTitle}</td>
                    <td><strong>{run.score}%</strong></td>
                    <td>{run.durationSeconds ? `${run.durationSeconds}s` : '—'}</td>
                    <td><span className={`status ${run.status === 'passed' ? 'green' : run.status === 'failed' ? 'amber' : 'gray'}`}>{run.status}</span></td>
                    <td>{new Date(run.startedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
