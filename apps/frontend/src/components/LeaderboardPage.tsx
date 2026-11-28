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

export interface HarborTaskSummary {
  id: string;
  title: string;
  category?: string;
  difficulty?: string;
  status?: string;
}

export interface HarborRunEntry {
  id: string;
  agentId: string;
  agentName: string;
  provider: string;
  adapterType: string;
  modelName: string;
  taskId: string | null;
  taskTitle: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  passedTasks: number;
  totalTasks: number;
  score: number;
  durationSeconds: number;
  startedAt: string;
}

const HARBOR_RUNS_STORAGE_KEY = 'forgebench_harbor_runs_v1';

export function loadHarborRuns(): HarborRunEntry[] {
  try {
    const raw = window.localStorage.getItem(HARBOR_RUNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHarborRuns(runs: HarborRunEntry[]): void {
  try {
    window.localStorage.setItem(HARBOR_RUNS_STORAGE_KEY, JSON.stringify(runs.slice(0, 100)));
  } catch {
    // Ignore storage quota errors in restricted environments.
  }
}

export function createHarborRunEntries(
  targetAgents: HarborAgentSummary[],
  task: HarborTaskSummary | null,
): HarborRunEntry[] {
  const now = new Date().toISOString();
  return targetAgents.map((agent, index) => ({
    id: `harbor-${Date.now()}-${index}-${agent.id.slice(0, 6)}`,
    agentId: agent.id,
    agentName: agent.name,
    provider: agent.provider,
    adapterType: agent.adapterType,
    modelName: agent.modelName || 'unassigned',
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? 'All benchmark tasks',
    status: 'queued',
    passedTasks: 0,
    totalTasks: 1,
    score: 0,
    durationSeconds: 0,
    startedAt: now,
  }));
}

export function LeaderboardPage({
  apiUrl,
}: {
  apiUrl: string;
}) {
  const [agents, setAgents] = useState<HarborAgentSummary[]>([]);
  const [tasks, setTasks] = useState<HarborTaskSummary[]>([]);
  const [runs, setRuns] = useState<HarborRunEntry[]>(() => loadHarborRuns());
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [agentsRes, tasksRes] = await Promise.all([
        fetch(`${apiUrl}/agents`).then(r => (r.ok ? r.json() : [])),
        fetch(`${apiUrl}/tasks`).then(r => (r.ok ? r.json() : [])),
      ]);
      setAgents(Array.isArray(agentsRes) ? agentsRes : []);
      setTasks(Array.isArray(tasksRes) ? tasksRes : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load agents or tasks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [apiUrl]);

  const handleRunHarbor = (agentIdOverride?: string) => {
    setError('');
    const targetId = agentIdOverride ?? selectedAgentId;
    const targetAgents = targetId === 'all'
      ? agents.filter(a => a.status === 'ready')
      : agents.filter(a => a.id === targetId);

    if (targetAgents.length === 0) {
      setError(
        targetId === 'all'
          ? 'No ready agents found. Register or set an agent to Ready in Settings first.'
          : 'Selected agent was not found.',
      );
      return;
    }

    const task = selectedTaskId === 'all'
      ? null
      : tasks.find(t => t.id === selectedTaskId) ?? null;

    const newEntries = createHarborRunEntries(targetAgents, task);
    const updated = [...newEntries, ...runs].slice(0, 100);
    setRuns(updated);
    saveHarborRuns(updated);
    setNotice(
      targetId === 'all'
        ? `Queued Harbor evaluation across ${targetAgents.length} ready agent(s).`
        : `Queued Harbor evaluation for "${targetAgents[0].name}".`,
    );
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
          <button type="button" className="secondary-button" onClick={loadData} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => handleRunHarbor('all')}
            disabled={readyCount === 0}
          >
            <Play size={15} /> Run Harbor (All Ready Agents)
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
          <small>Queued &amp; recorded evaluations</small>
        </div>
        <div className="metric-card">
          <span>Top Pass Rate</span>
          <strong style={{ color: '#247044' }}>{topScore}%</strong>
          <small>Highest average score</small>
        </div>
        <div className="metric-card">
          <span>Available Tasks</span>
          <strong>{tasks.length}</strong>
          <small>Saved benchmark tasks</small>
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
            Benchmark Task
            <select value={selectedTaskId} onChange={e => setSelectedTaskId(e.target.value)}>
              <option value="all">All Saved Tasks ({tasks.length})</option>
              {tasks.map(task => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={() => handleRunHarbor()}
            disabled={agents.length === 0}
          >
            <Play size={15} /> Run Harbor
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
                  <th>Adapter</th>
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
                    <td><span className="tag-badge adapter">{row.agent.adapterType}</span></td>
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
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => {
                setRuns([]);
                saveHarborRuns([]);
              }}
            >
              Clear history
            </button>
          </div>
          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>Task</th>
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
