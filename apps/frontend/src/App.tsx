import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  Boxes, ChevronRight, CircleGauge, FolderKanban, GitBranch, Plus, X,
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Overview', icon: CircleGauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
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
  const [error, setError] = useState('');
  useEffect(() => {
    const load = async () => {
      try {
        const [summary, projectItems, repositoryItems] = await Promise.all([
          request<{ totalProjects: number; repositoriesConnected: number }>(`${apiUrl}/dashboard`),
          request<any[]>(`${apiUrl}/projects`),
          request<any[]>(`${apiUrl}/repositories`),
        ]);
        setDashboard(summary);
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
      <div className="metric-grid">
        <div className="metric-card"><span>Projects</span><strong>{dashboard?.totalProjects ?? '—'}</strong><small>{dashboard ? 'Saved in this workspace' : 'Loading workspace data'}</small></div>
        <div className="metric-card"><span>Connected repositories</span><strong>{dashboard?.repositoriesConnected ?? '—'}</strong><small>{dashboard ? 'Unique GitHub repositories' : 'Loading workspace data'}</small></div>
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

export default function App() {
  return <Shell />;
}
