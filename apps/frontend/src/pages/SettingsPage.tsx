import { useEffect, useState } from 'react';
import { Edit2, Plus, Power, RefreshCw, Trash2 } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import { AgentModal } from '../components/modals/AgentModal';
import type { Agent } from '../types/agent';

export function SettingsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'offline'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [seeding, setSeeding] = useState(false);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await request<Agent[]>(`${apiUrl}/agents`);
      setAgents(data);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load agents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleSeedDefaults = async () => {
    setSeeding(true);
    setError('');
    setNotice('');
    try {
      const seeded = await request<Agent[]>(`${apiUrl}/agents/seed`, { method: 'POST' });
      setAgents(seeded);
      setNotice('Default benchmark agents (Codex, Claude Code, Antigravity, Harbor) loaded successfully.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to seed default agents.');
    } finally {
      setSeeding(false);
    }
  };

  const handleToggleStatus = async (agent: Agent) => {
    const nextStatus = agent.status === 'ready' ? 'offline' : 'ready';
    try {
      await request<Agent>(`${apiUrl}/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      setAgents(items => items.map(a => (a.id === agent.id ? { ...a, status: nextStatus } : a)));
      setNotice(`Agent "${agent.name}" status changed to ${nextStatus}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to toggle status.');
    }
  };

  const handleDeleteAgent = async (agent: Agent) => {
    if (!window.confirm(`Delete agent "${agent.name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await request(`${apiUrl}/agents/${agent.id}`, { method: 'DELETE' });
      setAgents(items => items.filter(a => a.id !== agent.id));
      setNotice(`Agent "${agent.name}" deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to delete agent.');
    }
  };

  const filteredAgents = agents.filter(agent => {
    const matchesSearch =
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.provider.toLowerCase().includes(search.toLowerCase()) ||
      agent.modelName.toLowerCase().includes(search.toLowerCase()) ||
      agent.description.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ? true : statusFilter === 'ready' ? agent.status === 'ready' : agent.status !== 'ready';
    return matchesSearch && matchesStatus;
  });

  const readyCount = agents.filter(a => a.status === 'ready').length;
  const offlineCount = agents.filter(a => a.status !== 'ready').length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Configuration & Runtime"
        title="Settings & Agent Management"
        action={
          <button
            className="primary-button"
            onClick={() => {
              setEditingAgent(null);
              setModalOpen(true);
            }}
          >
            <Plus size={17} /> Register agent
          </button>
        }
      />

      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}

      <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', maxWidth: '820px' }}>
        <div className="metric-card">
          <span>Configured Agents</span>
          <strong>{agents.length}</strong>
          <small>Registered AI runtimes</small>
        </div>
        <div className="metric-card">
          <span>Ready for Benchmarks</span>
          <strong style={{ color: '#247044' }}>{readyCount}</strong>
          <small>Active & verified harnesses</small>
        </div>
        <div className="metric-card">
          <span>Offline / Draft</span>
          <strong style={{ color: '#667085' }}>{offlineCount}</strong>
          <small>Pending configuration</small>
        </div>
      </div>

      <div className="filter-bar">
        <div
          className="search-field"
          style={{ background: 'white', border: '1px solid #d0d5dd', borderRadius: 8, padding: '0 10px' }}
        >
          <input
            className="filter-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter agents by name, model, provider…"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="filter-pills">
            <button
              className={`pill-button ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All ({agents.length})
            </button>
            <button
              className={`pill-button ${statusFilter === 'ready' ? 'active' : ''}`}
              onClick={() => setStatusFilter('ready')}
            >
              Ready ({readyCount})
            </button>
            <button
              className={`pill-button ${statusFilter === 'offline' ? 'active' : ''}`}
              onClick={() => setStatusFilter('offline')}
            >
              Offline ({offlineCount})
            </button>
          </div>
          <button
            className="secondary-button"
            onClick={handleSeedDefaults}
            disabled={seeding}
            title="Populate recommended agent baselines (Codex, Claude Code, Antigravity, Harbor)"
          >
            <RefreshCw size={14} />
            {seeding ? 'Seeding…' : 'Seed Defaults'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state compact">Loading agents…</div>
      ) : filteredAgents.length === 0 ? (
        <section className="panel empty-state">
          <h2>No coding agents found</h2>
          <p>Register a coding agent (Harbor or Direct CLI) or seed defaults to start benchmarking.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
            <button
              className="primary-button"
              onClick={() => {
                setEditingAgent(null);
                setModalOpen(true);
              }}
            >
              <Plus size={16} /> Register agent
            </button>
            <button className="secondary-button" onClick={handleSeedDefaults} disabled={seeding}>
              Seed default agents
            </button>
          </div>
        </section>
      ) : (
        <div className="agent-grid">
          {filteredAgents.map(agent => {
            const initials =
              agent.name
                .split(' ')
                .map(w => w[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase() || 'AG';
            const isReady = agent.status === 'ready';

            return (
              <div key={agent.id} className="agent-card-item">
                <div>
                  <div className="agent-card-head">
                    <div className="agent-card-identity">
                      <div className="agent-avatar-badge">{initials}</div>
                      <div className="agent-card-meta">
                        <strong>{agent.name}</strong>
                        <div className="agent-tags">
                          <span className="tag-badge provider">{agent.provider}</span>
                          <span className="tag-badge adapter">{agent.adapterType}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`status ${isReady ? 'green' : 'gray'}`}>{isReady ? 'Ready' : 'Offline'}</span>
                  </div>

                  <div className="agent-card-body" style={{ marginTop: 12 }}>
                    <p>{agent.description || 'No description provided.'}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="agent-card-specs">
                    <span>
                      Model: <strong>{agent.modelName || 'unassigned'}</strong>
                    </span>
                    <span>
                      Config: <strong>v{agent.configs?.length || 1}</strong>
                    </span>
                    <span>
                      Mode: <strong>{agent.settings?.executionMode || 'docker-sandbox'}</strong>
                    </span>
                    {agent.settings?.timeoutMinutes && (
                      <span>
                        Timeout: <strong>{agent.settings.timeoutMinutes}m</strong>
                      </span>
                    )}
                  </div>

                  <div className="agent-card-actions">
                    <button
                      className={`secondary-button ${isReady ? '' : 'primary-button'}`}
                      style={{ height: 32, fontSize: 12, padding: '0 10px' }}
                      onClick={() => handleToggleStatus(agent)}
                    >
                      <Power size={13} />
                      {isReady ? 'Set Offline' : 'Set Ready'}
                    </button>

                    <div className="action-group">
                      <button
                        className="secondary-button"
                        style={{ height: 32, fontSize: 12, padding: '0 10px' }}
                        onClick={() => {
                          setEditingAgent(agent);
                          setModalOpen(true);
                        }}
                        title="Edit agent parameters"
                      >
                        <Edit2 size={13} /> Edit
                      </button>
                      <button
                        className="secondary-button danger-button"
                        style={{ height: 32, fontSize: 12, padding: '0 10px' }}
                        onClick={() => handleDeleteAgent(agent)}
                        title="Delete agent"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <AgentModal
          agent={editingAgent}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            loadAgents();
            setNotice(
              editingAgent ? `Agent "${editingAgent.name}" updated successfully.` : 'New agent registered successfully.',
            );
          }}
        />
      )}
    </div>
  );
}
