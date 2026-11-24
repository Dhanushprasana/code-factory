import { useEffect, useState } from 'react';
import { Award, CheckCircle2, Clock, Cpu, Filter, RefreshCw, Terminal, Trophy, XCircle } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import type { Evaluation, LeaderboardEntry } from '../types/evaluation';

export function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [lbData, evalsData] = await Promise.all([
        request<LeaderboardEntry[]>(`${apiUrl}/leaderboard`).catch(() => []),
        request<Evaluation[]>(`${apiUrl}/evaluations`).catch(() => []),
      ]);
      setLeaderboard(lbData);
      setEvaluations(evalsData);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Could not load leaderboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredLeaderboard = leaderboard.filter(entry => {
    const q = search.toLowerCase();
    return (
      entry.agentName.toLowerCase().includes(q) ||
      entry.modelName.toLowerCase().includes(q) ||
      entry.provider.toLowerCase().includes(q)
    );
  });

  const totalRuns = leaderboard.reduce((sum, e) => sum + e.totalRuns, 0);
  const overallPassed = leaderboard.reduce((sum, e) => sum + e.passedRuns, 0);
  const overallPassRate = totalRuns > 0 ? ((overallPassed / totalRuns) * 100).toFixed(1) : '0';
  const topAgent = leaderboard.length > 0 ? leaderboard[0] : null;

  return (
    <div className="page leaderboard-page">
      <PageHeader
        eyebrow="Harbor Evaluation Benchmark Suite"
        title="Model Benchmark Leaderboard"
        action={
          <button className="secondary-button" onClick={loadData} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <p className="task-page-intro">
        Comprehensive agent benchmarking powered by the <b>Harbor Evaluation Framework</b>.
        Autonomous coding models are evaluated on isolated repository benchmarks, measuring task pass rates,
        execution trajectories, and code generation accuracy.
      </p>

      {error && <div className="inline-notice error" role="alert">{error}</div>}

      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="panel stat-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', color: '#667085' }}>
            <Trophy size={18} color="#f79009" />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Top Performer</span>
          </div>
          <strong style={{ fontSize: '1.35rem', color: '#101828' }}>{topAgent ? topAgent.modelName : '—'}</strong>
          <small style={{ color: '#475467', display: 'block', marginTop: 4 }}>
            {topAgent ? `${topAgent.passRate}% pass rate (${topAgent.agentName})` : 'No evaluations recorded'}
          </small>
        </div>

        <div className="panel stat-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', color: '#667085' }}>
            <Award size={18} color="#027a48" />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Overall Benchmark Pass Rate</span>
          </div>
          <strong style={{ fontSize: '1.35rem', color: '#101828' }}>{overallPassRate}%</strong>
          <small style={{ color: '#475467', display: 'block', marginTop: 4 }}>
            {overallPassed} of {totalRuns} total task attempts passed
          </small>
        </div>

        <div className="panel stat-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', color: '#667085' }}>
            <Cpu size={18} color="#6941c6" />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Benchmarked Models</span>
          </div>
          <strong style={{ fontSize: '1.35rem', color: '#101828' }}>{leaderboard.length}</strong>
          <small style={{ color: '#475467', display: 'block', marginTop: 4 }}>Configured autonomous agents</small>
        </div>
      </div>

      <section className="panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#101828', margin: 0 }}>Model Rankings</h2>
            <p style={{ fontSize: '0.85rem', color: '#667085', margin: '2px 0 0' }}>Ranked by pass rate and benchmark completion score</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Filter size={15} color="#667085" />
            <input
              type="text"
              placeholder="Filter by model, agent or provider…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: '6px 12px', fontSize: '0.85rem', borderRadius: '6px', border: '1px solid #d0d5dd', minWidth: '240px' }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#667085' }}>Loading leaderboard rankings…</div>
        ) : filteredLeaderboard.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#667085' }}>
            <Trophy size={36} color="#d0d5dd" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 600, margin: 0 }}>No benchmark evaluations yet</p>
            <p style={{ fontSize: '0.85rem', margin: '4px 0 0' }}>
              Run Harbor evaluations on tasks from the Task Library to populate the rankings.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eaecf0', color: '#475467' }}>
                  <th style={{ padding: '10px 12px' }}>Rank</th>
                  <th style={{ padding: '10px 12px' }}>Model & Agent</th>
                  <th style={{ padding: '10px 12px' }}>Provider</th>
                  <th style={{ padding: '10px 12px' }}>Pass Rate</th>
                  <th style={{ padding: '10px 12px' }}>Avg Reward</th>
                  <th style={{ padding: '10px 12px' }}>Solved / Total</th>
                  <th style={{ padding: '10px 12px' }}>Avg Latency</th>
                  <th style={{ padding: '10px 12px' }}>Last Run</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeaderboard.map((entry, idx) => {
                  const rankBadge = idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`;
                  return (
                    <tr key={entry.agentId} style={{ borderBottom: '1px solid #f2f4f7' }}>
                      <td style={{ padding: '12px', fontWeight: 700, color: idx < 3 ? '#b54708' : '#344054' }}>
                        {rankBadge}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600, color: '#101828' }}>{entry.modelName}</div>
                        <div style={{ fontSize: '0.78rem', color: '#667085' }}>{entry.agentName}</div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span className="tag-badge provider">{entry.provider}</span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '80px', height: '8px', background: '#eaecf0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${entry.passRate}%`,
                                height: '100%',
                                background: entry.passRate >= 70 ? '#12b76a' : entry.passRate >= 40 ? '#f79009' : '#f04438',
                              }}
                            />
                          </div>
                          <strong>{entry.passRate}%</strong>
                        </div>
                      </td>
                      <td style={{ padding: '12px', fontWeight: 600 }}>{entry.averageReward}</td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ color: '#027a48', fontWeight: 600 }}>{entry.passedRuns}</span> / {entry.totalRuns}
                      </td>
                      <td style={{ padding: '12px', color: '#475467' }}>
                        {entry.averageDurationMs ? `${(entry.averageDurationMs / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td style={{ padding: '12px', color: '#667085', fontSize: '0.8rem' }}>
                        {new Date(entry.lastEvaluatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Evaluation Runs */}
      {evaluations.length > 0 && (
        <section className="panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#101828', marginBottom: '1rem' }}>
            Recent Evaluation Runs
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {evaluations.slice(0, 10).map(ev => {
              const passed = ev.status === 'passed' || ev.reward >= 1.0;
              return (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #eaecf0',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {passed ? (
                      <CheckCircle2 size={20} color="#12b76a" />
                    ) : ev.status === 'running' ? (
                      <RefreshCw size={20} color="#f79009" className="animate-spin" />
                    ) : (
                      <XCircle size={20} color="#f04438" />
                    )}
                    <div>
                      <strong style={{ color: '#101828', fontSize: '0.9rem' }}>{ev.modelName}</strong>
                      <span style={{ color: '#667085', fontSize: '0.8rem', marginLeft: '8px' }}>
                        via {ev.agentName} ({ev.provider})
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        background: passed ? '#ecfdf3' : ev.status === 'running' ? '#fffaeb' : '#fef3f2',
                        color: passed ? '#027a48' : ev.status === 'running' ? '#b54708' : '#b42318',
                      }}
                    >
                      {ev.status} (Reward: {ev.reward})
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#667085', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={13} /> {ev.durationMs ? `${(ev.durationMs / 1000).toFixed(1)}s` : '—'}
                    </span>
                    {ev.trajectoryLogs && (
                      <button
                        className="secondary-button"
                        style={{ padding: '4px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => setSelectedEvaluation(ev)}
                      >
                        <Terminal size={13} /> Trajectory Log
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Trajectory Modal */}
      {selectedEvaluation && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedEvaluation(null)}>
          <div
            className="modal"
            style={{ width: 'min(760px, calc(100vw - 32px))', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            role="dialog"
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <span className="eyebrow">Harbor Trajectory Log</span>
                <h3 style={{ margin: 0 }}>{selectedEvaluation.modelName} Evaluation</h3>
              </div>
              <button className="secondary-button" onClick={() => setSelectedEvaluation(null)}>Close</button>
            </div>
            <pre
              style={{
                flex: 1,
                background: '#101828',
                color: '#eaecf0',
                padding: '1rem',
                borderRadius: '6px',
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: '450px',
              }}
            >
              {selectedEvaluation.trajectoryLogs || '(No trajectory logs captured)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
