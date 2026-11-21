import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  Boxes,
  ChevronRight,
  CircleGauge,
  Edit2,
  FolderKanban,
  GitBranch,
  Plus,
  Power,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Overview', icon: CircleGauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const apiUrl = 'http://127.0.0.1:4000/api/v1';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed (${response.status}).`);
  }
  return response.json();
}

function Shell() {
  const [modal, setModal] = useState(false);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">F</div><div><strong>ForgeBench</strong><span>Benchmark Studio</span></div></div>
        <nav aria-label="Primary navigation">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <span>Project workspace</span>
          <button className="primary-button" onClick={() => setModal(true)}><Plus size={17} /> New project</button>
        </header>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/projects" element={<Projects onNewProject={() => setModal(true)} />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {modal && <NewProjectModal onClose={() => setModal(false)} onCreated={() => window.dispatchEvent(new Event('forgebench-projects-updated'))} />}
    </div>
  );
}

function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{action}</div>;
}

function Overview() {
  const [dashboard, setDashboard] = useState<{ totalProjects: number; repositoriesConnected: number } | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [agentsCount, setAgentsCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = async () => {
      try {
        const [summary, projectItems, repositoryItems, agentItems] = await Promise.all([
          request<{ totalProjects: number; repositoriesConnected: number }>(`${apiUrl}/dashboard`),
          request<any[]>(`${apiUrl}/projects`),
          request<any[]>(`${apiUrl}/repositories`),
          request<any[]>(`${apiUrl}/agents`).catch(() => []),
        ]);
        setDashboard(summary);
        setAgentsCount(agentItems.length);
        setProjects(projectItems.map(project => ({
          ...project,
          repositoryCount: repositoryItems.filter(item => item.projectId === project.id).length,
        })));
        setError('');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load workspace data.');
      }
    };
    void load();
    window.addEventListener('forgebench-projects-updated', load);
    return () => window.removeEventListener('forgebench-projects-updated', load);
  }, []);
  return (
    <div className="page">
      <PageHeader eyebrow="Workspace" title="Overview" />
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', maxWidth: '920px' }}>
        <div className="metric-card"><span>Projects</span><strong>{dashboard?.totalProjects ?? '—'}</strong><small>{dashboard ? 'Saved in this workspace' : 'Loading workspace data'}</small></div>
        <div className="metric-card"><span>Connected repositories</span><strong>{dashboard?.repositoriesConnected ?? '—'}</strong><small>{dashboard ? 'Unique GitHub repositories' : 'Loading workspace data'}</small></div>
        <div className="metric-card"><span>Coding agents</span><strong>{agentsCount ?? '—'}</strong><small>{agentsCount !== null ? 'Registered benchmark agents' : 'Loading agents'}</small></div>
      </div>
      <section className="panel">
        <div className="panel-head"><div><span className="eyebrow">Workspace data</span><h2>Projects</h2></div></div>
        {projects.length ? projects.slice(0, 5).map(project => <ProjectRow key={project.id} name={project.name} repos={`${project.repositoryCount} connected repositories`} status={project.status === 'active' ? 'Active' : project.status} />) : !error && <div className="empty-state compact">{dashboard ? 'No projects yet. Create a project to connect repositories.' : 'Loading projects…'}</div>}
      </section>
    </div>
  );
}

function ProjectRow({ name, repos, status }: { name: string; repos: string; status: string }) {
  return <div className="project-row"><div className="project-icon"><Boxes size={18} /></div><div className="row-main"><strong>{name}</strong><span>{repos}</span></div><span className={`status ${status === 'Active' ? 'green' : 'gray'}`}>{status}</span><ChevronRight size={16} /></div>;
}

function Projects({ onNewProject }: { onNewProject: () => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState('');
  const [components, setComponents] = useState<any[]>([]);
  const [repoModal, setRepoModal] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadProjects = async () => {
    try {
      const result = await request<any[]>(`${apiUrl}/projects`);
      setError('');
      setProjects(result);
      setProjectId(current => result.some(project => project.id === current) ? current : (result[0]?.id ?? ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load projects.');
    }
  };
  useEffect(() => {
    loadProjects();
    window.addEventListener('forgebench-projects-updated', loadProjects);
    return () => window.removeEventListener('forgebench-projects-updated', loadProjects);
  }, []);
  useEffect(() => {
    if (!projectId) {
      setComponents([]);
      return;
    }
    request<any[]>(`${apiUrl}/projects/${projectId}/repositories`)
      .then(setComponents)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load repositories.'));
  }, [projectId]);
  const selectedProject = projects.find(project => project.id === projectId);
  const clone = async (association: any) => {
    setError('');
    setNotice('');
    try {
      await request(`${apiUrl}/projects/${projectId}/repositories/${association.repositoryId}/snapshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: association.selectedBranch, commitSha: association.selectedCommitSha }),
      });
      setNotice(`Pinned snapshot ${association.selectedCommitSha.slice(0, 12)} cloned and verified.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Snapshot clone failed.');
    }
  };
  const removeRepository = async (association: any) => {
    if (!window.confirm(`Disconnect ${association.repository.fullName} from this project? The repository record and snapshots will be kept.`)) return;
    try {
      await request(`${apiUrl}/projects/${projectId}/repositories/${association.repositoryId}`, { method: 'DELETE' });
      setComponents(items => items.filter(item => item.id !== association.id));
      setNotice(`${association.repository.fullName} disconnected from this project.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect repository.');
    }
  };
  const deleteProject = async () => {
    if (!selectedProject || !window.confirm(`Delete "${selectedProject.name}"? Project links will be removed; repository records and snapshots are retained.`)) return;
    try {
      await request(`${apiUrl}/projects/${projectId}`, { method: 'DELETE' });
      await loadProjects();
      setNotice('Project deleted. Repository records and snapshots were retained.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete project.');
    }
  };
  return (
    <div className="page">
      <PageHeader eyebrow="Portfolio" title="Projects" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> Create project</button>} />
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {projects.length === 0 ? <section className="panel empty-state"><h2>Create a project to get started</h2><p>Projects group repositories and their pinned commit baselines.</p><button className="primary-button" onClick={onNewProject}><Plus size={17} /> Create project</button></section> : <>
      <div className="project-picker"><label htmlFor="project-select">Project</label><select id="project-select" value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
      <div className="project-detail">
        <aside className="project-summary">
          <div className="project-logo">{(selectedProject?.name ?? 'P').slice(0, 2).toUpperCase()}</div><h2>{selectedProject?.name}</h2><p>{selectedProject?.description || 'Project repositories and immutable baselines.'}</p>
          <div className="summary-meta"><span>Components <strong>{components.length}</strong></span><span>Commits pinned <strong>{components.filter(item => item.selectedCommitSha).length}</strong></span></div>
          <button className="secondary-button danger-button" onClick={deleteProject}>Delete project</button>
        </aside>
        <section className="component-panel">
          <div className="panel-head"><div><span className="eyebrow">Project components</span><h2>Repository baselines</h2></div><div className="panel-actions"><button className="secondary-button" onClick={() => request<{url:string}>(`${apiUrl}/github/install-url`).then(result => window.open(result.url, '_blank', 'noopener,noreferrer')).catch(reason => setError(reason.message))}>Connect GitHub</button><button className="secondary-button" onClick={() => setRepoModal(true)}><Plus size={16} /> Add repository</button></div></div>
          {components.length === 0 && <div className="empty-state compact">No repositories connected to this project yet.</div>}
          {components.map(association => <div className="repository-row" key={association.id}><div className="repo-icon"><GitBranch size={18} /></div><div className="row-main"><strong>{association.repository.fullName}</strong><span>{association.repoRole} · branch {association.selectedBranch || association.repository.defaultBranch}</span></div><code title={association.selectedCommitSha}>{association.selectedCommitSha?.slice(0, 12) ?? 'No commit'}</code><button className="secondary-button" onClick={() => clone(association)}>Clone snapshot</button><button className="secondary-button danger-button" onClick={() => removeRepository(association)}>Remove</button></div>)}
        </section>
      </div>
      </>}
      {repoModal && projectId && <AddRepositoryModal projectId={projectId} onClose={() => setRepoModal(false)} onAdded={() => {
        setRepoModal(false);
        request<any[]>(`${apiUrl}/projects/${projectId}/repositories`).then(setComponents).catch(reason => setError(reason.message));
      }} />}
    </div>
  );
}

function AddRepositoryModal({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [role, setRole] = useState('backend');
  const [branch, setBranch] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const repositoryAddress = () => {
    const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (!match) throw new Error('Enter a GitHub repository URL before loading branches.');
    return { owner: match[1], name: match[2] };
  };
  const searchRepositories = async () => {
    setError('');
    try {
      setMatches(await request<any[]>(`${apiUrl}/github/repositories?query=${encodeURIComponent(search)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GitHub search failed.');
    }
  };
  const loadBranches = async () => {
    setError('');
    try {
      const { owner, name } = repositoryAddress();
      setBranches(await request<any[]>(`${apiUrl}/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load branches.');
    }
  };
  const loadCommits = async (value: string) => {
    setBranch(value);
    setCommitSha('');
    setError('');
    try {
      const { owner, name } = repositoryAddress();
      setCommits(await request<any[]>(`${apiUrl}/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?branch=${encodeURIComponent(value)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load commits.');
    }
  };
  const addRepository = async () => {
    setBusy(true);
    setError('');
    try {
      await request(`${apiUrl}/projects/${projectId}/repositories`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, role, branch: branch || undefined, commitSha: commitSha || undefined }),
      });
      onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect repository.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal repository-modal" role="dialog" aria-modal="true" aria-label="Add GitHub repository" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">Project component</span><h2>Connect repository</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <label>Find an authorized or public repository<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Repository name" /></label>
        <button className="secondary-button modal-secondary" onClick={searchRepositories} disabled={!search.trim()}>Search GitHub</button>
        {matches.length > 0 && <select aria-label="Search results" defaultValue="" onChange={event => {
          const item = matches.find(repository => String(repository.externalRepoId) === event.target.value);
          if (item) setUrl(item.cloneUrl);
        }}><option value="" disabled>Select a result</option>{matches.map(item => <option key={item.externalRepoId} value={item.externalRepoId}>{item.fullName}{item.isPrivate ? ' · private' : ''}</option>)}</select>}
        <label>GitHub HTTPS URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" /></label>
        <div className="field-grid"><label>Component role<select value={role} onChange={event => setRole(event.target.value)}><option value="frontend">Frontend</option><option value="backend">Backend</option><option value="data_engineering">Data engineering</option><option value="ml">ML</option><option value="other">Other</option></select></label><div className="load-control"><span>Branch and commit</span><button className="secondary-button" onClick={loadBranches}>Load branches</button></div></div>
        {branches.length > 0 && <label>Branch<select value={branch} onChange={event => loadCommits(event.target.value)}><option value="">Select branch</option>{branches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>}
        {commits.length > 0 && <label>Commit<select value={commitSha} onChange={event => setCommitSha(event.target.value)}><option value="">Select commit</option>{commits.map(item => <option key={item.sha} value={item.sha}>{item.sha.slice(0, 10)} · {item.message.split('\n')[0]}</option>)}</select></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <p className="form-hint">Public repositories work without credentials. Private repositories require a ForgeBench GitHub App installation with repository contents and metadata read access.</p>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !url.trim()} onClick={addRepository}>{busy ? 'Connecting…' : 'Add repository'}</button></div>
      </div>
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const createProject = async () => {
    setBusy(true);
    setError('');
    try {
      await request(`${apiUrl}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      onCreated();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create project.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Create project" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">New workspace</span><h2>Create project</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <label>Project name<input value={name} onChange={event => setName(event.target.value)} /></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()} onClick={createProject}>{busy ? 'Creating…' : 'Create project'}</button></div>
      </div>
    </div>
  );
}

interface AgentConfig {
  id: string;
  agentId: string;
  configVersion: number;
  modelName: string;
  settings: Record<string, any>;
  credentialReference?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface Agent {
  id: string;
  name: string;
  adapterType: string;
  provider: string;
  description: string;
  status: string;
  modelName: string;
  settings: Record<string, any>;
  credentialReference?: string | null;
  configs?: AgentConfig[];
  createdAt: string;
  updatedAt: string;
}

function SettingsPage() {
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
            <div className="search-field" style={{ background: 'white', border: '1px solid #d0d5dd', borderRadius: 8, padding: '0 10px' }}>
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
                        <span className={`status ${isReady ? 'green' : 'gray'}`}>
                          {isReady ? 'Ready' : 'Offline'}
                        </span>
                      </div>

                      <div className="agent-card-body" style={{ marginTop: 12 }}>
                        <p>{agent.description || 'No description provided.'}</p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="agent-card-specs">
                        <span>Model: <strong>{agent.modelName || 'unassigned'}</strong></span>
                        <span>Config: <strong>v{agent.configs?.length || 1}</strong></span>
                        <span>Mode: <strong>{agent.settings?.executionMode || 'docker-sandbox'}</strong></span>
                        {agent.settings?.timeoutMinutes && (
                          <span>Timeout: <strong>{agent.settings.timeoutMinutes}m</strong></span>
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
            setNotice(editingAgent ? `Agent "${editingAgent.name}" updated successfully.` : 'New agent registered successfully.');
          }}
        />
      )}
    </div>
  );
}

function AgentModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(agent);
  const [name, setName] = useState(agent?.name ?? '');
  const [provider, setProvider] = useState(agent?.provider ?? 'Anthropic');
  const [adapterType, setAdapterType] = useState(agent?.adapterType ?? 'direct-cli');
  const [modelName, setModelName] = useState(agent?.modelName ?? 'claude-3-7-sonnet');
  const [status, setStatus] = useState(agent?.status ?? 'ready');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [executionMode, setExecutionMode] = useState(agent?.settings?.executionMode ?? 'docker-sandbox');
  const [timeoutMinutes, setTimeoutMinutes] = useState(agent?.settings?.timeoutMinutes ?? 25);
  const [credentialReference, setCredentialReference] = useState(agent?.credentialReference ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Agent name is required.');
      return;
    }

    setBusy(true);
    setError('');

    const payload = {
      name: name.trim(),
      provider: provider.trim(),
      adapterType: adapterType.trim(),
      modelName: modelName.trim(),
      status: status.trim(),
      description: description.trim(),
      credentialReference: credentialReference.trim() || null,
      settings: {
        ...(agent?.settings || {}),
        executionMode,
        timeoutMinutes: Number(timeoutMinutes) || 25,
      },
    };

    try {
      if (isEdit && agent) {
        await request(`${apiUrl}/agents/${agent.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await request(`${apiUrl}/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save agent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width: 'min(540px, calc(100vw - 32px))' }}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit agent' : 'Register agent'}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">{isEdit ? 'Update Integration' : 'New Integration'}</span>
            <h2>{isEdit ? 'Edit Coding Agent' : 'Register Coding Agent'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label>
          Agent Name *
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Claude Code, Codex, Custom Runner"
          />
        </label>

        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ margin: 0, marginTop: 12 }}>
            Provider
            <select value={provider} onChange={e => setProvider(e.target.value)}>
              <option value="Anthropic">Anthropic</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Google DeepMind">Google DeepMind</option>
              <option value="Google">Google</option>
              <option value="Self-Hosted">Self-Hosted</option>
              <option value="Custom">Custom</option>
            </select>
          </label>

          <label style={{ margin: 0, marginTop: 12 }}>
            Adapter Type
            <select value={adapterType} onChange={e => setAdapterType(e.target.value)}>
              <option value="direct-cli">direct-cli (Subshell)</option>
              <option value="harbor">harbor (Adapter Bridge)</option>
            </select>
          </label>
        </div>

        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ margin: 0, marginTop: 12 }}>
            Model Name
            <input
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder="e.g. claude-3-7-sonnet"
            />
          </label>

          <label style={{ margin: 0, marginTop: 12 }}>
            Status
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="ready">Ready (Active)</option>
              <option value="offline">Offline</option>
            </select>
          </label>
        </div>

        <label>
          Description
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description of the agent's specialization or harness..."
            style={{ height: 60 }}
          />
        </label>

        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ margin: 0, marginTop: 12 }}>
            Execution Sandbox Mode
            <select value={executionMode} onChange={e => setExecutionMode(e.target.value)}>
              <option value="docker-sandbox">Docker Sandbox (Isolated)</option>
              <option value="cli-subshell">CLI Subshell</option>
              <option value="container-worktree">Container Worktree</option>
              <option value="harbor-bridge">Harbor Bridge</option>
            </select>
          </label>

          <label style={{ margin: 0, marginTop: 12 }}>
            Timeout (minutes)
            <input
              type="number"
              value={timeoutMinutes}
              onChange={e => setTimeoutMinutes(Number(e.target.value))}
              min={5}
              max={120}
            />
          </label>
        </div>

        <label>
          Credential / Secret Reference (Optional)
          <input
            value={credentialReference}
            onChange={e => setCredentialReference(e.target.value)}
            placeholder="e.g. ENV_AGENT_API_KEY (never plain secrets)"
          />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !name.trim()}
            onClick={handleSubmit}
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Register Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <Shell />;
}
