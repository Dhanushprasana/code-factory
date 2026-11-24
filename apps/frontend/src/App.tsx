import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Boxes,
  ClipboardList,
  ChevronRight,
  CircleGauge,
  Edit2,
  FolderKanban,
  GitBranch,
  History,
  Plus,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Overview', icon: CircleGauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/tasks/new', label: 'Task generator', icon: Sparkles },
  { to: '/tasks', label: 'Task library', icon: ClipboardList },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/analysis', label: 'Repository Analysis', icon: GitBranch },
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

type ProjectOption = { id: string; name: string };
type ProjectRepository = {
  id: string;
  repositoryId: string;
  repoRole: string;
  selectedBranch: string | null;
  selectedCommitSha: string | null;
  repository: { fullName: string; defaultBranch: string };
};
type AnalysisRecord = {
  id: string;
  repositoryId: string;
  snapshotId: string;
  commitSha: string;
  status: string;
  analyzerVersion: string;
  createdAt: string;
  updatedAt?: string;
  errorMessage?: string | null;
  warnings?: string[];
  summary?: Record<string, any> | null;
  report?: Record<string, any> | null;
  contextMarkdown?: string | null;
  contextStatus?: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | null;
  contextError?: string | null;
};

type FileTreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children: FileTreeNode[];
};

type FeatureArea = {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  routeCount: number;
  entityCount: number;
  testFileCount: number;
  testFiles: string[];
  documented: boolean;
};

type ModuleConnection = {
  source: string;
  target: string;
  calls: number;
};

function buildFileTree(entries: any[]): FileTreeNode[] {
  type MutableNode = { name: string; path: string; type: 'directory' | 'file'; children: Map<string, MutableNode> };
  const root = new Map<string, MutableNode>();
  for (const entry of entries) {
    const parts = String(entry.path ?? '').split('/').filter(Boolean);
    let siblings = root;
    let parentPath = '';
    parts.forEach((name: string, index: number) => {
      const path = parentPath ? `${parentPath}/${name}` : name;
      const isFile = index === parts.length - 1 && entry.type === 'file';
      let node = siblings.get(name);
      if (!node) {
        node = { name, path, type: isFile ? 'file' : 'directory', children: new Map() };
        siblings.set(name, node);
      }
      if (!isFile) {
        siblings = node.children;
        parentPath = path;
      }
    });
  }
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) => left.type === right.type
      ? left.name.localeCompare(right.name)
      : left.type === 'directory' ? -1 : 1);
    nodes.forEach(node => sortNodes(node.children));
    return nodes;
  };
  const convert = (nodes: Map<string, MutableNode>): FileTreeNode[] => sortNodes(
    [...nodes.values()].map(node => ({
      name: node.name,
      path: node.path,
      type: node.type,
      children: convert(node.children),
    })),
  );
  return convert(root);
}

function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  return nodes.flatMap(node => {
    if (node.path.toLowerCase().includes(query)) return [node];
    const children = filterFileTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function countTreeFiles(node: FileTreeNode): number {
  return node.type === 'file' ? 1 : node.children.reduce((sum, child) => sum + countTreeFiles(child), 0);
}

function findFileTreeNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findFileTreeNode(node.children, path);
    if (child) return child;
  }
  return undefined;
}

function FileTreeRows({
  nodes,
  depth,
  query,
  expandedPaths,
  selectedPath,
  onToggle,
  onSelect,
}: {
  nodes: FileTreeNode[];
  depth: number;
  query: string;
  expandedPaths: Set<string>;
  selectedPath: string;
  onToggle: (path: string) => void;
  onSelect: (node: FileTreeNode) => void;
}) {
  return <>{nodes.map(node => {
    const isExpanded = query ? true : expandedPaths.has(node.path);
    return <div key={node.path}>
      <button
        type="button"
        role="treeitem"
        className={`tree-node ${node.type} ${selectedPath === node.path ? 'selected' : ''}`}
        style={{ paddingLeft: `${10 + depth * 15}px` }}
        aria-level={depth + 1}
        aria-selected={selectedPath === node.path}
        aria-expanded={node.type === 'directory' ? isExpanded : undefined}
        onClick={() => {
          onSelect(node);
          if (node.type === 'directory') onToggle(node.path);
        }}
      >
        <span className="tree-caret">{node.type === 'directory' ? (isExpanded ? '▾' : '›') : '·'}</span>
        <span className="tree-name">{node.name}</span>
        {node.type === 'directory' && <span className="tree-count">{countTreeFiles(node)}</span>}
      </button>
      {node.type === 'directory' && isExpanded && node.children.length > 0 &&
        <FileTreeRows nodes={node.children} depth={depth + 1} query={query} expandedPaths={expandedPaths} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} />}
    </div>;
  })}</>;
}

function ModuleMapSvg({
  areas,
  connections,
  selectedAreaId,
  onSelect,
}: {
  areas: FeatureArea[];
  connections: ModuleConnection[];
  selectedAreaId: string;
  onSelect: (id: string) => void;
}) {
  const nodes = areas.slice(0, 18);
  const positions = new Map(nodes.map((area, index) => [area.id, {
    x: 28 + (index % 3) * 302,
    y: 110 + Math.floor(index / 3) * 108,
  }]));
  const visibleConnections = connections.filter(edge => positions.has(edge.source) && positions.has(edge.target));
  const height = Math.max(210, Math.ceil(nodes.length / 3) * 108 + 140);
  return <svg className="module-map-svg" viewBox={`0 0 940 ${height}`} role="img" aria-label="Repository module dependency map">
    <defs><marker id="module-map-arrow" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 z" fill="#9aa4b5" /></marker></defs>
    <g className="module-map-root">
      <rect x="349" y="20" width="242" height="64" rx="8" />
      <text className="module-map-title" x="470" y="47" textAnchor="middle">Repository snapshot</text>
      <text className="module-map-meta" x="470" y="66" textAnchor="middle">contains detected source areas</text>
    </g>
    {nodes.map(area => {
      const target = positions.get(area.id)!;
      return <path key={`contains-${area.id}`} className="module-map-containment" d={`M 470 84 C 470 100, ${target.x + 121} 90, ${target.x + 121} ${target.y}`} markerEnd="url(#module-map-arrow)" />;
    })}
    {visibleConnections.map(edge => {
      const source = positions.get(edge.source)!;
      const target = positions.get(edge.target)!;
      return <g key={`${edge.source}-${edge.target}`}>
        <path className="module-map-edge" d={`M ${source.x + 242} ${source.y + 31} C ${source.x + 272} ${source.y + 31}, ${target.x - 26} ${target.y + 31}, ${target.x - 8} ${target.y + 31}`} markerEnd="url(#module-map-arrow)" />
        {edge.calls > 1 && <text className="module-map-edge-label" x={(source.x + target.x) / 2 + 120} y={(source.y + target.y) / 2 + 25}>{edge.calls}</text>}
      </g>;
    })}
    {nodes.map(area => {
      const position = positions.get(area.id)!;
      return <g
        key={area.id}
        className={`module-map-node ${selectedAreaId === area.id ? 'selected' : ''}`}
        transform={`translate(${position.x},${position.y})`}
        role="button"
        tabIndex={0}
        aria-label={`${area.name} module, ${area.fileCount} files`}
        onClick={() => onSelect(area.id)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(area.id);
          }
        }}
      >
        <rect width="242" height="64" rx="8" />
        <text className="module-map-title" x="13" y="25">{area.name.length > 29 ? `${area.name.slice(0, 26)}…` : area.name}</text>
        <text className="module-map-meta" x="13" y="46">{area.fileCount} files · {area.routeCount} routes · {area.entityCount} entities</text>
      </g>;
    })}
  </svg>;
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
          <Route path="/tasks/new" element={<TaskGeneratorPage />} />
          <Route path="/tasks/:taskId" element={<TaskLibraryPage />} />
          <Route path="/tasks" element={<TaskLibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/analysis/:analysisId" element={<AnalysisPage />} />
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
  const navigate = useNavigate();
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
          {components.map(association => <div className="repository-row" key={association.id}><div className="repo-icon"><GitBranch size={18} /></div><div className="row-main"><strong>{association.repository.fullName}</strong><span>{association.repoRole} · branch {association.selectedBranch || association.repository.defaultBranch}</span></div><code title={association.selectedCommitSha}>{association.selectedCommitSha?.slice(0, 12) ?? 'No commit'}</code><button className="secondary-button" onClick={() => clone(association)}>Clone snapshot</button><button className="secondary-button" disabled={!association.selectedCommitSha} onClick={() => navigate(`/analysis?projectId=${encodeURIComponent(projectId)}&repositoryId=${encodeURIComponent(association.repositoryId)}`)}>Analyze</button><button className="secondary-button danger-button" onClick={() => removeRepository(association)}>Remove</button></div>)}
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

function AnalysisPage() {
  const navigate = useNavigate();
  const { analysisId } = useParams();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get('projectId') ?? '');
  const [associations, setAssociations] = useState<ProjectRepository[]>([]);
  const [repositoryId, setRepositoryId] = useState(searchParams.get('repositoryId') ?? '');
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [analysisView, setAnalysisView] = useState<'overview' | 'features' | 'structure' | 'modules' | 'context'>('overview');
  const [generatingContext, setGeneratingContext] = useState(false);
  const [contextCopied, setContextCopied] = useState(false);
  const [rawView, setRawView] = useState(false);
  const [featureQuery, setFeatureQuery] = useState('');
  const [featureLayer, setFeatureLayer] = useState('all');
  const [fileQuery, setFileQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');

  useEffect(() => {
    setAnalysisView('overview');
    setFeatureQuery('');
    setFeatureLayer('all');
    setFileQuery('');
    setExpandedPaths(new Set());
    setSelectedAreaId('');
    setSelectedFilePath('');
  }, [analysisId]);

  useEffect(() => {
    let active = true;
    request<ProjectOption[]>(`${apiUrl}/projects`)
      .then(items => {
        if (!active) return;
        setProjects(items);
        setProjectId(current => items.some(item => item.id === current) ? current : (items[0]?.id ?? ''));
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load projects.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setAssociations([]);
      setRepositoryId('');
      return;
    }
    let active = true;
    request<ProjectRepository[]>(`${apiUrl}/projects/${projectId}/repositories`)
      .then(items => {
        if (!active) return;
        setAssociations(items);
        setRepositoryId(current => items.some(item => item.repositoryId === current)
          ? current
          : (items.some(item => item.repositoryId === searchParams.get('repositoryId'))
            ? searchParams.get('repositoryId')!
            : (items[0]?.repositoryId ?? '')));
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load project repositories.');
      });
    return () => { active = false; };
  }, [projectId, searchParams]);

  useEffect(() => {
    if (!repositoryId) {
      setHistory([]);
      return;
    }
    let active = true;
    request<AnalysisRecord[]>(`${apiUrl}/repositories/${repositoryId}/analyses`)
      .then(items => { if (active) setHistory(items); })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load analysis history.');
      });
    return () => { active = false; };
  }, [repositoryId, analysisId]);

  useEffect(() => {
    if (!analysisId) {
      setAnalysis(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const result = await request<AnalysisRecord>(`${apiUrl}/analyses/${analysisId}`);
        if (!active) return;
        setAnalysis(result);
        setError('');
        if (
          result.status === 'queued' ||
          result.status === 'running' ||
          result.contextStatus === 'queued' ||
          result.contextStatus === 'running'
        ) {
          timer = window.setTimeout(load, 1500);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load repository analysis.');
      }
    };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [analysisId]);

  const selectedAssociation = associations.find(item => item.repositoryId === repositoryId);

  const triggerContextGeneration = async () => {
    if (!analysis?.id) return;
    setGeneratingContext(true);
    setError('');
    try {
      const result = await request<AnalysisRecord>(`${apiUrl}/analyses/${analysis.id}/context`, {
        method: 'POST',
      });
      setAnalysis(current => current ? { ...current, ...result, contextStatus: 'running' } : result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not trigger context generation.');
    } finally {
      setGeneratingContext(false);
    }
  };

  const copyContextMarkdown = () => {
    if (!analysis?.contextMarkdown) return;
    navigator.clipboard.writeText(analysis.contextMarkdown);
    setContextCopied(true);
    setTimeout(() => setContextCopied(false), 2000);
  };

  const downloadContextMarkdown = () => {
    if (!analysis?.contextMarkdown) return;
    const blob = new Blob([analysis.contextMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const repoName = (selectedAssociation?.repository.fullName || 'repository').replace(/[\/\\]/g, '-');
    link.download = `${repoName}-CONTEXT.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const startAnalysis = async () => {
    if (!selectedAssociation?.selectedCommitSha) return;
    setStarting(true);
    setError('');
    try {
      const result = await request<AnalysisRecord>(
        `${apiUrl}/repositories/${selectedAssociation.repositoryId}/analyze`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commitSha: selectedAssociation.selectedCommitSha }),
        },
      );
      navigate(`/analysis/${result.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start repository analysis.');
    } finally {
      setStarting(false);
    }
  };

  const summary = analysis?.summary;
  const report = analysis?.report;
  const dependencies = Object.entries(summary?.dependencies ?? {})
    .flatMap(([ecosystem, packages]) => Array.isArray(packages)
      ? packages.map((item: any) => ({ ecosystem, ...item }))
      : [])
    .slice(0, 40);
  const graph = report?.graph as { nodes?: any[]; edges?: any[] } | undefined;
  const features = Array.isArray(summary?.features) ? summary.features : [];
  const modules = Array.isArray(summary?.modules) ? summary.modules : [];
  const directoryTree = Array.isArray(report?.directory_tree) ? report.directory_tree : [];
  const apiRoutes = Array.isArray(summary?.api_routes) ? summary.api_routes : [];
  const databaseEntities = Array.isArray(summary?.database_entities) ? summary.database_entities : [];
  const testFiles = Array.isArray(report?.tests?.files) ? report.tests.files : [];
  const fileTree = useMemo(() => buildFileTree(directoryTree), [directoryTree]);
  const filteredFileTree = useMemo(() => filterFileTree(fileTree, fileQuery.trim().toLowerCase()), [fileTree, fileQuery]);
  const featureAreas = useMemo<FeatureArea[]>(() => {
    const fileEntries = directoryTree.filter((entry: any) => entry.type === 'file');
    if (modules.length) {
      return modules.map((module: any) => {
        const path = String(module.path);
        const underModule = (filePath: string) => filePath === path || filePath.startsWith(`${path}/`);
        return {
          id: path,
          name: String(module.name ?? path.split('/').pop()),
          path,
          fileCount: Number(module.file_count ?? fileEntries.filter((entry: any) => underModule(entry.path)).length),
          routeCount: Number(module.api_route_count ?? apiRoutes.filter((route: any) => underModule(route.file_path)).length),
          entityCount: Number(module.database_entity_count ?? databaseEntities.filter((entity: any) => underModule(entity.file_path)).length),
          testFileCount: Number(module.test_file_count ?? testFiles.filter((file: string) => underModule(file)).length),
          testFiles: testFiles.filter((file: string) => underModule(file)),
          documented: false,
        };
      });
    }
    return features.map((feature: any, index: number) => ({
      id: `documented-${index}`,
      name: String(feature.name ?? feature),
      path: String(feature.source ?? 'README.md'),
      fileCount: 0,
      routeCount: 0,
      entityCount: 0,
      testFileCount: 0,
      testFiles: [],
      documented: true,
    }));
  }, [modules, directoryTree, apiRoutes, databaseEntities, testFiles, features]);
  const visibleAreas = featureAreas.filter(area => {
    const queryMatches = `${area.name} ${area.path}`.toLowerCase().includes(featureQuery.trim().toLowerCase());
    const layerMatches = featureLayer === 'all'
      || (featureLayer === 'api' && area.routeCount > 0)
      || (featureLayer === 'data' && area.entityCount > 0)
      || (featureLayer === 'tests' && area.testFileCount > 0);
    return queryMatches && layerMatches;
  });
  const selectedArea = featureAreas.find(area => area.id === selectedAreaId) ?? featureAreas[0];
  const selectedTreeNode = findFileTreeNode(fileTree, selectedFilePath);
  const selectedRoutes = selectedTreeNode?.type === 'file' ? apiRoutes.filter((item: any) => item.file_path === selectedFilePath) : [];
  const selectedEntities = selectedTreeNode?.type === 'file' ? databaseEntities.filter((item: any) => item.file_path === selectedFilePath) : [];
  const selectedSymbols = selectedTreeNode?.type === 'file' ? (report?.symbols ?? []).filter((item: any) => item.file_path === selectedFilePath) : [];
  const selectedModule = featureAreas.filter(area => !area.documented && (selectedFilePath === area.path || selectedFilePath.startsWith(`${area.path}/`))).sort((a, b) => b.path.length - a.path.length)[0];
  const moduleConnections = useMemo<ModuleConnection[]>(() => {
    const nodeById = new Map((graph?.nodes ?? []).map((node: any) => [node.id, node]));
    const moduleForFile = (filePath?: string) => {
      if (!filePath) return undefined;
      return modules
        .filter((module: any) => filePath === module.path || filePath.startsWith(`${module.path}/`))
        .sort((left: any, right: any) => right.path.length - left.path.length)[0]?.path as string | undefined;
    };
    const counts = new Map<string, ModuleConnection>();
    for (const edge of graph?.edges ?? []) {
      if (edge.type !== 'calls') continue;
      const sourceModule = moduleForFile(nodeById.get(edge.source)?.file_path);
      const targetModule = moduleForFile(nodeById.get(edge.target)?.file_path);
      if (!sourceModule || !targetModule || sourceModule === targetModule) continue;
      const key = `${sourceModule}\u0000${targetModule}`;
      const current = counts.get(key) ?? { source: sourceModule, target: targetModule, calls: 0 };
      current.calls += 1;
      counts.set(key, current);
    }
    return [...counts.values()];
  }, [graph, modules]);

  useEffect(() => {
    if (featureAreas.length && !featureAreas.some(area => area.id === selectedAreaId)) {
      setSelectedAreaId(featureAreas[0].id);
    }
  }, [featureAreas, selectedAreaId]);

  const toggleDirectory = (path: string) => {
    setExpandedPaths(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const selectFeatureArea = (id: string) => {
    setSelectedAreaId(id);
    setAnalysisView('modules');
  };

  return (
    <div className="page">
      <PageHeader eyebrow="Repository intelligence" title="Repository Analysis" />
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <section className="panel analysis-controls">
        <div className="panel-head"><div><span className="eyebrow">Analyze a pinned baseline</span><h2>Select a project repository</h2></div></div>
        <div className="analysis-selectors">
          <label>Project<select value={projectId} onChange={event => {
            setProjectId(event.target.value);
            setRepositoryId('');
          }}><option value="">Select a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>Repository<select value={repositoryId} onChange={event => setRepositoryId(event.target.value)}><option value="">Select a repository</option>{associations.map(item => <option key={item.repositoryId} value={item.repositoryId}>{item.repository.fullName} · {item.selectedCommitSha?.slice(0, 12) ?? 'no commit'}</option>)}</select></label>
          <button className="primary-button" onClick={startAnalysis} disabled={starting || !selectedAssociation?.selectedCommitSha}>{starting ? 'Starting…' : 'Analyze snapshot'}</button>
        </div>
        {selectedAssociation && <p className="analysis-hint">Analysis runs against {selectedAssociation.repository.fullName} at commit <code>{selectedAssociation.selectedCommitSha}</code>. Clone that snapshot from Projects first if it has not been cloned yet.</p>}
      </section>

      {repositoryId && <section className="panel analysis-history">
        <div className="panel-head"><div><span className="eyebrow">Saved reports</span><h2>Analysis history</h2></div><span>{history.length} runs</span></div>
        {history.length === 0
          ? <div className="empty-state compact">No analyses yet. Clone a repository snapshot, then start an analysis.</div>
          : history.map(item => <button className={`analysis-history-row ${analysisId === item.id ? 'selected' : ''}`} key={item.id} onClick={() => navigate(`/analysis/${item.id}`)}>
            <span className={`status ${item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'amber'}`}>{item.status}</span>
            <code>{item.commitSha.slice(0, 12)}</code>
            <span>{new Date(item.createdAt).toLocaleString()}</span>
            <ChevronRight size={16} />
          </button>)}
      </section>}

      {analysis && <section className="analysis-report">
        <div className="analysis-repository-banner">
          <div className="analysis-banner-copy">
            <span className={`status ${analysis.status === 'completed' ? 'green' : analysis.status === 'failed' ? 'red' : 'amber'}`}>{analysis.status}</span>
            <h2>{selectedAssociation?.repository.fullName ?? 'Repository analysis'}</h2>
            <p>Commit-pinned repository analysis · Analyzer {analysis.analyzerVersion}</p>
          </div>
          <div className="analysis-repo-facts">
            <span><b>Commit</b>{analysis.commitSha.slice(0, 12)}</span>
            <span><b>Snapshot</b>{analysis.snapshotId.slice(0, 8)}</span>
            <span><b>Files</b>{summary?.file_count?.toLocaleString() ?? '—'}</span>
            <span><b>Analyzed</b>{new Date(analysis.updatedAt ?? analysis.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        {analysis.status === 'queued' || analysis.status === 'running'
          ? <div className="panel analysis-progress"><strong>{analysis.status === 'queued' ? 'Analysis queued' : 'Analyzing repository…'}</strong><p>The scanner is extracting repository structure and code relationships. This page will update automatically.</p></div>
          : analysis.status === 'failed'
            ? <div className="inline-notice error">{analysis.errorMessage ?? 'Repository analysis failed.'}</div>
            : summary && report && <>
              {(analysis.warnings ?? []).length > 0 && <div className="inline-notice analysis-warnings"><strong>Analyzer notes</strong><ul>{analysis.warnings?.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
              <div className="analysis-metrics">
                <div className="metric-card"><span>Files discovered</span><strong>{summary.file_count ?? '—'}</strong></div>
                <div className="metric-card"><span>Source files parsed</span><strong>{summary.analyzed_source_file_count ?? '—'}</strong></div>
                <div className="metric-card"><span>Symbols</span><strong>{Array.isArray(report.symbols) ? report.symbols.length : '—'}</strong></div>
                <div className="metric-card"><span>API routes</span><strong>{summary.api_route_count ?? (Array.isArray(summary.api_routes) ? summary.api_routes.length : 0)}</strong></div>
              </div>
              <div className="analysis-tabs" role="tablist" aria-label="Repository analysis views">
                {([
                  ['overview', 'Overview'],
                  ['features', 'Feature map', featureAreas.length],
                  ['structure', 'File structure'],
                  ['modules', 'Module map', featureAreas.length],
                  ['context', 'Context file'],
                ] as const).map(([id, label, count]) => <button
                  type="button"
                  key={id}
                  id={`analysis-tab-${id}`}
                  role="tab"
                  aria-controls={`analysis-panel-${id}`}
                  aria-selected={analysisView === id}
                  className={`analysis-tab ${analysisView === id ? 'active' : ''}`}
                  onClick={() => setAnalysisView(id as any)}
                >{label}{typeof count === 'number' && <span>{count}</span>}</button>)}
              </div>

              {analysisView === 'overview' && <div id="analysis-panel-overview" role="tabpanel" aria-labelledby="analysis-tab-overview" className="analysis-view-grid">
                <section className="panel analysis-card">
                  <div className="panel-head"><div><span className="eyebrow">Repository overview</span><h2>Architecture at a glance</h2></div><span className="status gray">Commit pinned</span></div>
                  <div className="analysis-card-body">
                    <p className="analysis-summary-copy">This report is grounded in the selected snapshot. Browse detected source areas, repository files, and statically resolved module calls in the tabs above.</p>
                    <div className="analysis-overview-metrics">
                      <div><b>{featureAreas.length}</b><span>source areas</span></div>
                      <div><b>{testFiles.length}</b><span>test files</span></div>
                      <div><b>{summary.database_entity_count ?? databaseEntities.length}</b><span>database entities</span></div>
                      <div><b>{summary.api_route_count ?? apiRoutes.length}</b><span>API routes</span></div>
                    </div>
                    <h3>Entry points</h3>
                    <div className="tag-list">{(summary.entry_points ?? []).map((item: string) => <code className="analysis-tag" key={item}>{item}</code>)}</div>
                    <h3>README sections</h3>
                    {features.length ? <div className="tag-list">{features.slice(0, 18).map((item: any, index: number) => <span className="analysis-tag" key={`${item.name ?? item}-${index}`}>{item.name ?? item}</span>)}</div> : <p>No README headings were detected.</p>}
                  </div>
                </section>
                <section className="panel analysis-card">
                  <div className="panel-head"><div><span className="eyebrow">Technology</span><h2>Detected stack</h2></div></div>
                  <div className="analysis-card-body">
                    <h3>Languages</h3><div className="tag-list">{(summary.language ?? []).map((language: string) => <span className="analysis-tag" key={language}>{language}{summary.language_file_counts?.[language] ? ` · ${summary.language_file_counts[language]} files` : ''}</span>)}</div>
                    <h3>Frameworks and data</h3><div className="tag-list">{[...(summary.frameworks ?? []), ...(summary.database ?? []), ...(summary.orm ?? [])].map((item: string) => <span className="analysis-tag" key={item}>{item}</span>)}</div>
                    <h3>Package managers</h3><p>{(summary.package_managers ?? []).join(', ') || 'Not detected'}</p>
                    <h3>Build and test commands</h3><p><strong>Build:</strong> {(summary.build_commands ?? []).join(', ') || 'Not detected'}</p><p><strong>Test:</strong> {(summary.test_commands ?? []).join(', ') || 'Not detected'}</p>
                  </div>
                </section>
                <section className="panel analysis-card">
                  <div className="panel-head"><div><span className="eyebrow">Manifest scan</span><h2>Dependencies</h2></div><span>{dependencies.length} shown</span></div>
                  <div className="analysis-table">
                    {dependencies.length ? dependencies.map((item: any) => <div className="analysis-table-row" key={`${item.ecosystem}-${item.name}`}><strong>{item.name}</strong><code>{item.version}</code><span>{item.ecosystem}</span></div>) : <div className="empty-state compact">No supported dependency manifests found.</div>}
                  </div>
                </section>
                <section className="panel analysis-card">
                  <div className="panel-head"><div><span className="eyebrow">API and persistence</span><h2>Detected interfaces</h2></div><span>{apiRoutes.length + databaseEntities.length} details shown</span></div>
                  <div className="analysis-card-body">
                    <h3>API routes ({summary.api_route_count ?? apiRoutes.length})</h3>
                    {apiRoutes.slice(0, 12).map((route: any, index: number) => <div className="analysis-reference" key={`${route.file_path}-${route.line}-${index}`}><strong>{route.method} {route.path}</strong><code>{route.file_path}:{route.line}</code></div>)}
                    {!apiRoutes.length && <p>No route declarations were detected.</p>}
                    <h3>Database entities ({summary.database_entity_count ?? databaseEntities.length})</h3>
                    {databaseEntities.slice(0, 12).map((entity: any, index: number) => <div className="analysis-reference" key={`${entity.file_path}-${entity.line}-${index}`}><strong>{entity.name}</strong><code>{entity.file_path}:{entity.line}</code></div>)}
                    {!databaseEntities.length && <p>No entity declarations were detected.</p>}
                    <p className="analysis-hint">Route and entity lists are bounded; see analyzer notes for truncation details.</p>
                  </div>
                </section>
                <section className="panel analysis-card analysis-card-wide">
                  <div className="panel-head"><div><span className="eyebrow">Verification signals</span><h2>Test files and development notes</h2></div><span>{testFiles.length} test files</span></div>
                  <div className="analysis-card-body">
                    <div className="analysis-test-files">{testFiles.slice(0, 24).map((file: string) => <span className="analysis-tag" key={file}>{file}</span>)}</div>
                    {(report.potential_development_areas ?? []).map((item: string) => <p className="analysis-opportunity" key={item}>{item}</p>)}
                    <p className="analysis-hint">Coverage is not inferred from test-file names. The analyzer lists test files and configured commands but does not execute tests.</p>
                  </div>
                </section>
              </div>}

              {analysisView === 'features' && <section id="analysis-panel-features" role="tabpanel" aria-labelledby="analysis-tab-features" className="analysis-feature-view">
                <div className="analysis-view-intro">
                  <div><span className="eyebrow">Source-grounded map</span><h2>Feature map</h2><p>Areas are grouped from detected source folders. They are structural evidence, not AI-assigned product capabilities.</p></div>
                  <div className="analysis-feature-filters">
                    <input type="search" aria-label="Filter feature areas" placeholder="Filter feature areas" value={featureQuery} onChange={event => setFeatureQuery(event.target.value)} />
                    <select aria-label="Filter feature areas by evidence" value={featureLayer} onChange={event => setFeatureLayer(event.target.value)}>
                      <option value="all">All areas</option><option value="api">Has API routes</option><option value="data">Has entities</option><option value="tests">Has test files</option>
                    </select>
                  </div>
                </div>
                {featureAreas.some(area => area.documented) && <div className="inline-notice">No source modules were detected. These fallback areas come from README headings only.</div>}
                <div className="analysis-feature-grid">
                  {visibleAreas.map(area => <button type="button" className={`analysis-feature-card ${selectedAreaId === area.id ? 'selected' : ''}`} key={area.id} onClick={() => selectFeatureArea(area.id)}>
                    <span className="analysis-feature-card-heading"><strong>{area.name}</strong><span className="status gray">{area.documented ? 'README' : 'Source module'}</span></span>
                    <code>{area.path}</code>
                    <div className="analysis-feature-stats"><span><b>{area.fileCount}</b> files</span><span><b>{area.routeCount}</b> routes</span><span><b>{area.entityCount}</b> entities</span></div>
                    <small>{area.testFileCount} test files · Select to inspect relationships</small>
                  </button>)}
                  {!visibleAreas.length && <div className="empty-state compact">No feature areas match these filters.</div>}
                </div>
                {features.length > 0 && <section className="panel analysis-card">
                  <div className="panel-head"><div><span className="eyebrow">Repository documentation</span><h2>README headings</h2></div><span>Documentation signals only</span></div>
                  <div className="analysis-card-body"><div className="tag-list">{features.slice(0, 30).map((item: any, index: number) => <span className="analysis-tag" key={`${item.name ?? item}-${index}`}>{item.name ?? item}</span>)}</div></div>
                </section>}
              </section>}

              {analysisView === 'structure' && <div id="analysis-panel-structure" role="tabpanel" aria-labelledby="analysis-tab-structure" className="file-explorer-layout">
                <section className="panel file-tree-panel">
                  <div className="panel-head"><div><span className="eyebrow">Pinned snapshot</span><h2>Project files</h2></div><span>{directoryTree.length.toLocaleString()} entries</span></div>
                  <div className="file-tree-search"><input type="search" aria-label="Search snapshot files" placeholder="Filter files and folders" value={fileQuery} onChange={event => setFileQuery(event.target.value)} /></div>
                  <div className="file-tree-list" role="tree" aria-label="Snapshot file structure">
                    {filteredFileTree.length
                      ? <FileTreeRows nodes={filteredFileTree} depth={0} query={fileQuery.trim()} expandedPaths={expandedPaths} selectedPath={selectedFilePath} onToggle={toggleDirectory} onSelect={node => setSelectedFilePath(node.path)} />
                      : <div className="empty-state compact">No files match this search.</div>}
                  </div>
                </section>
                <section className="panel file-detail-panel">
                  <div className="panel-head"><div><span className="eyebrow">Snapshot item</span><h2>{selectedTreeNode?.name ?? 'Select a file or folder'}</h2></div><span className="status gray">{selectedTreeNode?.type === 'directory' ? 'Directory' : selectedTreeNode ? 'File' : 'Overview'}</span></div>
                  <div className="analysis-card-body">
                    {selectedTreeNode ? <>
                      <code className="file-detail-path">{selectedTreeNode.path}</code>
                      {selectedTreeNode.type === 'directory'
                        ? <p>{countTreeFiles(selectedTreeNode)} files are listed under this folder in the bounded snapshot tree.</p>
                        : <>
                          <p>{selectedModule ? `Source area: ${selectedModule.name} (${selectedModule.path}).` : 'This path is present in the selected pinned snapshot.'} {testFiles.includes(selectedFilePath) ? 'Detected as a test file.' : ''}</p>
                          <h3>Detected symbols ({selectedSymbols.length})</h3>
                          {selectedSymbols.length ? <div className="tag-list">{selectedSymbols.slice(0, 24).map((symbol: any, index: number) => <span className="analysis-tag" key={`${symbol.name}-${symbol.start_line}-${index}`}>{symbol.kind} · {symbol.name}</span>)}</div> : <p>No symbols were parsed from this file.</p>}
                          <h3>API routes</h3>{selectedRoutes.length ? selectedRoutes.map((route: any, index: number) => <div className="analysis-reference" key={`${route.method}-${route.line}-${index}`}><strong>{route.method} {route.path || '(path not resolved)'}</strong><code>line {route.line}</code></div>) : <p>No route declarations detected in this file.</p>}
                          <h3>Database entities</h3>{selectedEntities.length ? selectedEntities.map((entity: any, index: number) => <div className="analysis-reference" key={`${entity.name}-${entity.line}-${index}`}><strong>{entity.name}</strong><code>line {entity.line}</code></div>) : <p>No entity declarations detected in this file.</p>}
                        </>}
                      <p className="analysis-hint">File contents are not displayed. This view only presents metadata extracted from the pinned snapshot.</p>
                    </> : <p>Select a folder or file to inspect its location and analysis evidence.</p>}
                  </div>
                </section>
              </div>}

              {analysisView === 'modules' && <section id="analysis-panel-modules" role="tabpanel" aria-labelledby="analysis-tab-modules" className="analysis-module-view">
                <div className="analysis-view-intro">
                  <div><span className="eyebrow">Static relationships</span><h2>Module map</h2><p>Directed edges show cross-module calls that the static parser could resolve. Missing edges do not imply that modules are unrelated.</p></div>
                  <span className="status gray">{featureAreas.length} areas · {moduleConnections.length} cross-module links</span>
                </div>
                <div className="module-map-layout">
                  <div className="panel module-map-canvas">
                    {featureAreas.length
                      ? <ModuleMapSvg areas={featureAreas} connections={moduleConnections} selectedAreaId={selectedArea?.id ?? ''} onSelect={setSelectedAreaId} />
                      : <div className="empty-state compact">No modules or README areas are available for this snapshot.</div>}
                    {featureAreas.length > 18 && <p className="analysis-hint">The map displays the first 18 areas. Use the feature map to browse the full detected list.</p>}
                    {!moduleConnections.length && <p className="analysis-hint">No cross-module calls were statically resolved for this snapshot.</p>}
                    <div className="module-map-legend"><span><i className="containment-key" />Folder containment</span><span><i className="dependency-key" />Resolved cross-module calls</span></div>
                  </div>
                  <aside className="panel module-map-details">
                    {selectedArea ? <>
                      <span className="status gray">{selectedArea.documented ? 'README heading' : 'Source module'}</span>
                      <h3>{selectedArea.name}</h3>
                      <code>{selectedArea.path}</code>
                      <div className="module-detail-metrics"><span><b>{selectedArea.fileCount}</b> files</span><span><b>{selectedArea.testFileCount}</b> tests</span><span><b>{selectedArea.routeCount}</b> routes</span></div>
                      <h4>Resolved relationships</h4>
                      {moduleConnections.filter(edge => edge.source === selectedArea.id || edge.target === selectedArea.id).map(edge => <div className="analysis-reference" key={`${edge.source}-${edge.target}`}><strong>{edge.source === selectedArea.id ? 'Calls' : 'Called by'}</strong><code>{edge.source === selectedArea.id ? edge.target : edge.source} · {edge.calls}</code></div>)}
                      {!moduleConnections.some(edge => edge.source === selectedArea.id || edge.target === selectedArea.id) && <p>No cross-module call edge was resolved for this area.</p>}
                      <button type="button" className="secondary-button" onClick={() => setAnalysisView('features')}>Browse feature map</button>
                    </> : <p>Select a module node to inspect its evidence.</p>}
                  </aside>
                </div>
              </section>}

              {analysisView === 'context' && <section id="analysis-panel-context" role="tabpanel" aria-labelledby="analysis-tab-context" className="analysis-context-view">
                <div className="analysis-view-intro context-view-intro">
                  <div>
                    <span className="eyebrow">Repository Blueprint & Knowledge</span>
                    <h2>Context file (<code>CONTEXT.md</code>)</h2>
                    <p>Comprehensive architecture, feature inventory, data models, and API interfaces synthesized with NVIDIA Nemotron 3.5 Super VL.</p>
                  </div>
                  <div className="context-view-actions">
                    {analysis.contextStatus === 'completed' && analysis.contextMarkdown && <>
                      <button type="button" className="secondary-button" onClick={() => setRawView(!rawView)}>
                        {rawView ? 'Rendered View' : 'Raw Markdown'}
                      </button>
                      <button type="button" className="secondary-button" onClick={copyContextMarkdown}>
                        {contextCopied ? 'Copied!' : 'Copy Markdown'}
                      </button>
                      <button type="button" className="secondary-button" onClick={downloadContextMarkdown}>
                        Download .md
                      </button>
                      <button type="button" className="secondary-button" disabled={generatingContext} onClick={triggerContextGeneration}>
                        Regenerate
                      </button>
                    </>}
                    {(!analysis.contextMarkdown && analysis.contextStatus !== 'running' && analysis.contextStatus !== 'queued') && (
                      <button type="button" className="primary-button" disabled={generatingContext} onClick={triggerContextGeneration}>
                        {generatingContext ? 'Requesting...' : 'Generate Context File'}
                      </button>
                    )}
                  </div>
                </div>

                {(analysis.contextStatus === 'running' || analysis.contextStatus === 'queued') && (
                  <div className="context-status-bar in-progress">
                    <div className="context-status-bar-info">
                      <div className="context-spinner" />
                      <div>
                        <strong>Synthesizing repository context...</strong>
                        <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#475467' }}>
                          Analyzing grounded AST symbols, manifest dependencies, endpoints, and architecture using <code>nvidia/nemotron-3.5-super-vl:free</code>. This view will update automatically.
                        </p>
                      </div>
                    </div>
                    <span className="status amber" style={{ textTransform: 'uppercase', fontSize: '10px' }}>In Progress</span>
                  </div>
                )}

                {analysis.contextStatus === 'failed' && (
                  <div className="context-status-bar failed">
                    <div>
                      <strong>Context generation failed</strong>
                      <p style={{ margin: '3px 0 0', fontSize: '11px' }}>{analysis.contextError || 'An error occurred while generating repository context.'}</p>
                    </div>
                    <button type="button" className="primary-button" onClick={triggerContextGeneration} disabled={generatingContext}>
                      Retry
                    </button>
                  </div>
                )}

                {analysis.contextMarkdown ? (
                  <div className="context-markdown-container">
                    <div className="context-markdown-toolbar">
                      <span><strong>CONTEXT.md</strong> &bull; Generated with NVIDIA Nemotron 3.5 Super VL</span>
                      <span>{analysis.contextMarkdown.length} characters &bull; ~{Math.round(analysis.contextMarkdown.length / 4)} tokens</span>
                    </div>
                    {rawView ? (
                      <textarea
                        className="context-markdown-raw"
                        readOnly
                        value={analysis.contextMarkdown}
                      />
                    ) : (
                      <div className="context-markdown-body">
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', background: 'transparent', color: 'inherit', padding: 0 }}>
                          {analysis.contextMarkdown}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  analysis.contextStatus !== 'running' && analysis.contextStatus !== 'queued' && (
                    <div className="empty-state compact" style={{ padding: '40px 20px', textAlign: 'center' }}>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#344054', marginBottom: '8px' }}>
                        No context file generated yet for this snapshot.
                      </p>
                      <p style={{ fontSize: '12px', color: '#667085', maxWidth: '480px', margin: '0 auto 16px' }}>
                        Generate a comprehensive, single-file Markdown blueprint containing executive summary, system design, feature matrix, data schemas, and runtime instructions.
                      </p>
                      <button type="button" className="primary-button" onClick={triggerContextGeneration} disabled={generatingContext}>
                        Generate Context File (.md)
                      </button>
                    </div>
                  )
                )}
              </section>}
            </>}
      </section>}
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
            onChange={e => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. Claude Code, Codex, Custom Runner"
            style={!name.trim() ? { borderColor: '#fda29b' } : undefined}
          />
        </label>
        {!name.trim() && (
          <span style={{ fontSize: 11, color: '#b42318', marginTop: 4, display: 'block' }}>
            Agent name is required.
          </span>
        )}

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
            title={!name.trim() ? 'Agent name is required to save' : undefined}
            onClick={handleSubmit}
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Register Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

type TaskContextComponent = {
  repositoryId: string;
  repositoryName: string;
  role: string;
  branch: string | null;
  commitSha: string | null;
  analysisId: string | null;
  snapshotId: string | null;
  analyzedAt: string | null;
  modules: string[];
  ready: boolean;
};

type TaskGeneration = {
  id: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  candidates?: TaskCandidate[];
  errorMessage?: string | null;
  createdAt: string;
};

type TaskProvider = 'openrouter' | 'ollama';

type TaskCandidate = {
  title: string;
  description: string;
  category: string;
  difficulty: string;
  requirements: string[];
  acceptance_criteria: string[];
  constraints: string[];
  affected_modules: string[];
  evidence: Array<{
    repository_id: string;
    snapshot_id: string;
    commit_sha: string;
    file_path: string;
    start_line: number;
    end_line: number;
    symbol?: string | null;
  }>;
};

type SavedTask = {
  id: string;
  projectId: string;
  generationId: string | null;
  version: number;
  currentVersion: number;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  status: string;
  requirements: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  affectedModules: string[];
  baselineManifest: Array<{ repositoryId: string; snapshotId: string; analysisId: string; commitSha: string }>;
  contextManifest: Record<string, any>;
  evidence: TaskCandidate['evidence'];
  createdAt: string;
  updatedAt: string;
};

type ReferenceSolution = {
  id: string;
  taskId: string;
  taskVersion: number;
  version: number;
  status: string;
  provider: TaskProvider;
  model: string | null;
  promptVersion: string | null;
  implementationPlan: Array<{
    repository_id: string;
    file_path: string;
    action: string;
    rationale: string;
    steps: string[];
  }> | null;
  patches: Array<{ repository_id: string; patch_diff: string }> | null;
  tests: Array<{
    repository_id: string;
    file_path: string;
    test_type: string;
    purpose: string;
    content: string;
  }> | null;
  contextManifest: Record<string, any> | null;
  validation: Record<string, any> & {
    patch_preflight?: string;
    apply_status?: string;
    apply_error?: string | null;
    workspace?: {
      repositories?: Array<{
        repository_id: string;
        repository_name: string;
        directory: string;
        build_commands: string[];
        test_commands: string[];
      }>;
    };
    execution_runs?: Array<Record<string, any>>;
  };
  reviewNote: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const taskCategories = [
  ['feature', 'Feature implementation'],
  ['bug_fix', 'Bug fixing'],
  ['api_enhancement', 'API enhancement'],
  ['refactoring', 'Refactoring'],
  ['database_change', 'Database change'],
  ['performance', 'Performance improvement'],
  ['test_improvement', 'Test improvement'],
] as const;

function TaskGeneratorPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [components, setComponents] = useState<TaskContextComponent[]>([]);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<string[]>([]);
  const [history, setHistory] = useState<TaskGeneration[]>([]);
  const [generation, setGeneration] = useState<TaskGeneration | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [draft, setDraft] = useState<TaskCandidate | null>(null);
  const [idea, setIdea] = useState('');
  const [provider, setProvider] = useState<TaskProvider | ''>('');
  const [category, setCategory] = useState('feature');
  const [difficulty, setDifficulty] = useState('medium');
  const [constraints, setConstraints] = useState('');
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    request<ProjectOption[]>(`${apiUrl}/projects`)
      .then(items => {
        setProjects(items);
        setProjectId(current => items.some(item => item.id === current) ? current : (items[0]?.id ?? ''));
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load projects.'));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setComponents([]);
      setSelectedAnalysisIds([]);
      setHistory([]);
      return;
    }
    let active = true;
    setError('');
    Promise.all([
      request<{ components: TaskContextComponent[] }>(`${apiUrl}/projects/${projectId}/task-context`),
      request<TaskGeneration[]>(`${apiUrl}/projects/${projectId}/task-generations`),
    ]).then(([context, runs]) => {
      if (!active) return;
      setComponents(context.components);
      setSelectedAnalysisIds(context.components.filter(item => item.ready && item.analysisId).map(item => item.analysisId!));
      setHistory(runs);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load project task context.');
    });
    return () => { active = false; };
  }, [projectId]);

  const selectedCandidate = generation?.candidates?.[candidateIndex];
  const selectCandidate = (index: number) => {
    setCandidateIndex(index);
    setDraft(generation?.candidates?.[index] ?? null);
  };
  const toggleAnalysis = (analysisId: string) => {
    setSelectedAnalysisIds(current => current.includes(analysisId)
      ? current.filter(id => id !== analysisId)
      : [...current, analysisId]);
  };
  const generate = async () => {
    setError('');
    setNotice('');
    setGeneration(null);
    setDraft(null);
    if (!projectId) {
      setError('Create or select a project before generating tasks.');
      return;
    }
    if (!selectedAnalysisIds.length) {
      setError('Select at least one component with a completed analysis for its pinned commit.');
      return;
    }
    if (!provider) {
      setError('Choose OpenRouter or Ollama before generating task drafts.');
      return;
    }
    setBusy(true);
    try {
      const result = await request<TaskGeneration>(`${apiUrl}/projects/${projectId}/tasks/suggest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          analysisIds: selectedAnalysisIds,
          userIdea: idea.trim() || undefined,
          category,
          difficulty,
          constraints: constraints.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
          count,
        }),
      });
      setGeneration(result);
      setCandidateIndex(0);
      setDraft(result.candidates?.[0] ?? null);
      setHistory(current => [result, ...current.filter(run => run.id !== result.id)]);
      setNotice(`Generated ${result.candidates?.length ?? 0} repository-grounded draft(s) with ${result.provider} · ${result.model}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Task generation failed.');
    } finally {
      setBusy(false);
    }
  };
  const loadGeneration = (generationId: string) => {
    const selected = history.find(run => run.id === generationId);
    if (!selected?.candidates?.length) {
      setError(selected?.errorMessage ?? 'This generation has no saved suggestions.');
      return;
    }
    setError('');
    setGeneration(selected);
    setCandidateIndex(0);
    setDraft(selected.candidates[0]);
    setNotice(`Loaded generation from ${new Date(selected.createdAt).toLocaleString()}.`);
  };
  const saveDraft = async () => {
    if (!generation || !draft || !projectId) return;
    setSaving(true);
    setError('');
    try {
      const saved = await request<SavedTask>(`${apiUrl}/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          generationId: generation.id,
          candidateIndex,
          title: draft.title,
          description: draft.description,
          category: draft.category,
          difficulty: draft.difficulty,
          requirements: draft.requirements,
          acceptanceCriteria: draft.acceptance_criteria,
          constraints: draft.constraints,
          affectedModules: draft.affected_modules,
        }),
      });
      navigate(`/tasks/${saved.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this task draft.');
    } finally {
      setSaving(false);
    }
  };
  const changeDraft = (field: keyof TaskCandidate, value: string | string[]) => {
    setDraft(current => current ? { ...current, [field]: value } : current);
  };

  return <div className="page task-workspace">
    <PageHeader eyebrow="Task creation" title="Task generator" action={<button className="secondary-button" onClick={() => navigate('/tasks')}><ClipboardList size={15} /> Task library</button>} />
    <p className="task-page-intro">Create task drafts from completed analyses of this project's pinned repository snapshots. Every suggestion keeps file and commit provenance for review.</p>
    {error && <div className="inline-notice error" role="alert">{error}</div>}
    {notice && <div className="inline-notice" role="status">{notice}</div>}
    <div className="task-layout">
      <section className="panel task-form">
        <div className="panel-head"><div><span className="eyebrow">Step 1 · project scope</span><h2>Task configuration</h2></div><Sparkles size={18} /></div>
        <label>Project workspace
          <select value={projectId} onChange={event => { setProjectId(event.target.value); setGeneration(null); setDraft(null); }}>
            <option value="">Choose a project…</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <p className="form-hint">Only the selected project's connected repositories and their current pinned commits can be used as task context.</p>
        <div className="task-context-picker">
          <div className="task-subhead"><strong>Analyzed project components</strong><span>{selectedAnalysisIds.length} selected</span></div>
          {components.length ? components.map(component => <label className="task-context-option" key={component.repositoryId}>
            <input type="checkbox" checked={Boolean(component.analysisId && selectedAnalysisIds.includes(component.analysisId))} disabled={!component.ready || !component.analysisId} onChange={() => component.analysisId && toggleAnalysis(component.analysisId)} />
            <span><b>{component.repositoryName}</b><small>{component.role} · {component.branch || 'branch unavailable'} · {component.commitSha?.slice(0, 12) ?? 'No pinned commit'}</small>
              <small>{component.ready ? `${component.modules.length} modules · analyzed ${component.analyzedAt ? new Date(component.analyzedAt).toLocaleDateString() : ''}` : 'Clone the selected snapshot and complete its repository analysis first.'}</small>
            </span>
            <span className={`status ${component.ready ? 'green' : 'amber'}`}>{component.ready ? 'Ready' : 'Needs analysis'}</span>
          </label>) : <div className="empty-state compact">Connect, clone, and analyze a repository before creating a task.</div>}
        </div>
        <label>Task idea (optional)
          <textarea value={idea} onChange={event => setIdea(event.target.value)} maxLength={1000} placeholder="e.g. Make order cancellation idempotent and preserve inventory invariants" />
        </label>
        <div className="field-grid">
          <label>Category<select value={category} onChange={event => setCategory(event.target.value)}>{taskCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Difficulty<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        </div>
        <label>Additional constraints (one per line)
          <textarea value={constraints} onChange={event => setConstraints(event.target.value)} placeholder={'Keep current API behavior backward compatible\nInclude invalid-input and boundary cases'} />
        </label>
        <label>Suggestions to generate<select value={count} onChange={event => setCount(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option><option value={5}>5</option></select></label>
        <label>AI provider
          <select value={provider} onChange={event => {
            const value = event.target.value;
            setProvider(value === 'openrouter' || value === 'ollama' ? value : '');
          }}>
            <option value="">Choose a provider…</option>
            <option value="openrouter">OpenRouter (hosted models)</option>
            <option value="ollama">Ollama (local model)</option>
          </select>
        </label>
        <p className="form-hint">
          OpenRouter needs an API key in the backend environment. Ollama needs a running local server and a pulled model. Source context goes only to the provider you select.
        </p>
        <div className="task-form-actions"><button className="primary-button" onClick={generate} disabled={busy || !selectedAnalysisIds.length || !provider}><Sparkles size={16} />{busy ? 'Generating from repository context…' : 'Generate task drafts'}</button></div>
        <p className="form-hint">Repository code is treated as untrusted input; ForgeBench does not execute it.</p>
      </section>
      <section className="panel task-guardrails">
        <div className="panel-head"><div><span className="eyebrow">Review before saving</span><h2>Generation guardrails</h2></div><span className="status green">Enabled</span></div>
        <ul className="task-guardrail-list">
          <li><b>Commit pinned</b><span>Each draft records the selected repository snapshot and full commit SHA.</span></li>
          <li><b>Source grounded</b><span>Context uses keyword, structure, and static graph retrieval from completed analysis reports.</span></li>
          <li><b>Measurable criteria</b><span>Review requirements and acceptance criteria for observable behavior and edge cases.</span></li>
          <li><b>Human editable</b><span>Generated wording is a draft. Edit it and save only after review.</span></li>
          <li><b>No hidden claims</b><span>Source references and affected modules are validated against the retrieved snapshot context.</span></li>
        </ul>
        <div className="demo-notice">Choose OpenRouter for hosted models or Ollama to keep repository context on your local model endpoint. Provider credentials and model names are configured separately in the backend environment.</div>
        <div className="task-history">
          <div className="task-subhead"><strong><History size={15} /> Generation history</strong><span>{history.length} runs</span></div>
          {history.length ? <select aria-label="Load previous task generation" defaultValue="" onChange={event => event.target.value && loadGeneration(event.target.value)}>
            <option value="">Choose a previous generation…</option>
            {history.map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString()} · {run.provider || 'provider unknown'} · {run.status} · {run.candidates?.length ?? 0} suggestions</option>)}
          </select> : <p className="form-hint">Generation runs are recorded here for this project.</p>}
        </div>
      </section>
    </div>
    <section className="panel task-preview">
      <div className="panel-head"><div><span className="eyebrow">Step 2 · review and edit</span><h2>Generated task preview</h2></div><span className={`status ${generation?.status === 'completed' ? 'green' : 'gray'}`}>{generation?.status ?? 'Waiting for generation'}</span></div>
      {!generation?.candidates?.length || !draft ? <div className="empty-state">Configure a project with an analyzed snapshot, then generate task drafts to review them here.</div> : <>
        <div className="task-candidate-tabs" role="tablist" aria-label="Task suggestions">{generation.candidates.map((candidate, index) => <button type="button" className={index === candidateIndex ? 'selected' : ''} key={`${candidate.title}-${index}`} onClick={() => selectCandidate(index)}>Draft {index + 1}<small>{candidate.title}</small></button>)}</div>
        {selectedCandidate && <div className="task-review-grid">
          <div className="task-review-fields">
            <label>Title<input value={draft.title} maxLength={160} onChange={event => changeDraft('title', event.target.value)} /></label>
            <label>Description<textarea value={draft.description} maxLength={3000} rows={4} onChange={event => changeDraft('description', event.target.value)} /></label>
            <div className="field-grid"><label>Category<select value={draft.category} onChange={event => changeDraft('category', event.target.value)}>{taskCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Difficulty<select value={draft.difficulty} onChange={event => changeDraft('difficulty', event.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div>
            <label>Requirements (one per line)<textarea rows={5} value={draft.requirements.join('\n')} onChange={event => changeDraft('requirements', event.target.value.split(/\r?\n/))} /></label>
            <label>Acceptance criteria (one per line)<textarea rows={5} value={draft.acceptance_criteria.join('\n')} onChange={event => changeDraft('acceptance_criteria', event.target.value.split(/\r?\n/))} /></label>
            <label>Constraints (one per line)<textarea rows={3} value={draft.constraints.join('\n')} onChange={event => changeDraft('constraints', event.target.value.split(/\r?\n/))} /></label>
          </div>
          <aside className="task-evidence-panel">
            <h3>Repository evidence</h3>
            <div className="task-module-tags">{draft.affected_modules.map(module => <span className="analysis-tag" key={module}>{module}</span>)}</div>
            {draft.evidence.map((evidence, index) => <div className="task-evidence-item" key={`${evidence.snapshot_id}-${evidence.file_path}-${index}`}>
              <b>{evidence.symbol || 'Source evidence'}</b><code>{evidence.file_path}:{evidence.start_line}-{evidence.end_line}</code><small>Commit {evidence.commit_sha.slice(0, 12)}</small>
            </div>)}
            <div className="task-form-actions"><button className="primary-button" onClick={saveDraft} disabled={saving}>{saving ? 'Saving draft…' : 'Save reviewed draft'}</button></div>
            <p className="form-hint">Saving creates task version 1. Later edits create immutable versions and retain the original commit/context manifest.</p>
          </aside>
        </div>}
      </>}
    </section>
  </div>;
}

function TaskLibraryPage() {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState<SavedTask[]>([]);
  const [task, setTask] = useState<SavedTask | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; version: number; content: Record<string, any>; createdAt: string }>>([]);
  const [referenceSolutions, setReferenceSolutions] = useState<ReferenceSolution[]>([]);
  const [selectedReferenceId, setSelectedReferenceId] = useState('');
  const [referenceFeedback, setReferenceFeedback] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [constraints, setConstraints] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<ProjectOption[]>(`${apiUrl}/projects`).then(setProjects)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load projects.'));
  }, []);
  useEffect(() => {
    const url = projectId ? `${apiUrl}/projects/${projectId}/tasks` : `${apiUrl}/tasks`;
    request<SavedTask[]>(url).then(setTasks)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load tasks.'));
  }, [projectId]);
  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setVersions([]);
      setReferenceSolutions([]);
      setSelectedReferenceId('');
      setReferenceFeedback('');
      setReviewNote('');
      return;
    }
    Promise.all([
      request<SavedTask>(`${apiUrl}/tasks/${taskId}`),
      request<Array<{ id: string; version: number; content: Record<string, any>; createdAt: string }>>(`${apiUrl}/tasks/${taskId}/versions`),
      request<ReferenceSolution[]>(`${apiUrl}/tasks/${taskId}/references`),
    ]).then(([loaded, history, references]) => {
      setTask(loaded);
      setProjectId(loaded.projectId);
      setVersions(history);
      setReferenceSolutions(references);
      setSelectedReferenceId(references[0]?.id ?? '');
      setReviewNote(references[0]?.reviewNote ?? '');
      setTitle(loaded.title);
      setDescription(loaded.description);
      setRequirements(loaded.requirements.join('\n'));
      setAcceptanceCriteria(loaded.acceptanceCriteria.join('\n'));
      setConstraints(loaded.constraints.join('\n'));
      setError('');
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load task details.'));
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !referenceSolutions.some(item =>
      item.status === 'queued'
      || item.status === 'running'
      || item.validation.execution_runs?.some(run => run.status === 'queued' || run.status === 'running'),
    )) return;
    const timer = window.setInterval(() => {
      request<ReferenceSolution[]>(`${apiUrl}/tasks/${taskId}/references`)
        .then(setReferenceSolutions)
        .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not refresh reference generation.'));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [taskId, referenceSolutions]);

  const selectedReference = referenceSolutions.find(item => item.id === selectedReferenceId) ?? referenceSolutions[0];
  const workspaceApplied = selectedReference?.validation.apply_status === 'applied';
  const activeValidationRun = selectedReference?.validation.execution_runs?.find(
    run => run.status === 'queued' || run.status === 'running',
  );
  const latestValidationRun = selectedReference?.validation.execution_runs?.[0];

  const saveChanges = async () => {
    if (!task) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<SavedTask>(`${apiUrl}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          requirements: requirements.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
          acceptanceCriteria: acceptanceCriteria.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
          constraints: constraints.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        }),
      });
      setTask(updated);
      const history = await request<typeof versions>(`${apiUrl}/tasks/${task.id}/versions`);
      setVersions(history);
      setNotice(`Saved task version ${updated.currentVersion}.`);
      setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save task changes.');
    } finally {
      setSaving(false);
    }
  };
  const generateReference = async () => {
    if (!task) return;
    setReferenceBusy(true);
    setError('');
    try {
      const generated = await request<ReferenceSolution>(`${apiUrl}/tasks/${task.id}/references/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewerFeedback: referenceFeedback.trim() || undefined }),
      });
      setSelectedReferenceId(generated.id);
      setReferenceSolutions(current => [generated, ...current.filter(item => item.id !== generated.id)]);
      setReviewNote(generated.reviewNote ?? '');
      setReferenceFeedback('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not queue reference generation.');
    } finally {
      setReferenceBusy(false);
    }
  };
  const applyReference = async () => {
    if (!selectedReference) return;
    setReferenceBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<ReferenceSolution>(`${apiUrl}/references/${selectedReference.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setReferenceSolutions(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice('Patches and generated test files were applied to an isolated copy of the pinned snapshot.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not apply reference patches.');
    } finally {
      setReferenceBusy(false);
    }
  };
  const executeReferenceValidation = async () => {
    if (!selectedReference) return;
    setReferenceBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<ReferenceSolution>(`${apiUrl}/references/${selectedReference.id}/validation/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setReferenceSolutions(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice('Build and test execution was queued in the isolated validation environment.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not queue automatic build and test execution.');
    } finally {
      setReferenceBusy(false);
    }
  };
  const reviewReference = async (action: 'approve' | 'request_changes' | 'reject') => {
    if (!selectedReference) return;
    setReferenceBusy(true);
    setError('');
    try {
      const updated = await request<ReferenceSolution>(`${apiUrl}/references/${selectedReference.id}/review`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note: reviewNote }),
      });
      setReferenceSolutions(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save reference review.');
    } finally {
      setReferenceBusy(false);
    }
  };

  return <div className="page task-library-page">
    <PageHeader eyebrow="Task workbench" title={task ? 'Task review' : 'Task library'} action={<button className="primary-button" onClick={() => navigate('/tasks/new')}><Sparkles size={15} /> New task</button>} />
    {error && <div className="inline-notice error" role="alert">{error}</div>}
    {notice && <div className="inline-notice" role="status">{notice}</div>}
    <div className="project-picker"><label htmlFor="task-library-project">Project</label><select id="task-library-project" value={projectId} onChange={event => { setProjectId(event.target.value); if (taskId) navigate('/tasks'); }}><option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
    <div className="task-library-layout">
      <section className="panel task-list-panel">
        <div className="panel-head"><div><span className="eyebrow">Saved task specifications</span><h2>{tasks.length} task{tasks.length === 1 ? '' : 's'}</h2></div></div>
        {tasks.length ? tasks.map(item => <button type="button" className={`task-library-row ${task?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => navigate(`/tasks/${item.id}`)}>
          <span><b>{item.title}</b><small>{projects.find(project => project.id === item.projectId)?.name ?? 'Project'} · {item.category.replaceAll('_', ' ')}</small><small>{item.baselineManifest.map(base => base.commitSha.slice(0, 10)).join(', ')}</small></span>
          <span className="task-row-meta"><span className={`status ${item.status === 'draft' ? 'amber' : 'gray'}`}>{item.status}</span><small>v{item.currentVersion}</small></span>
        </button>) : <div className="empty-state compact">No saved tasks yet. Generate and review a task draft to populate the library.</div>}
      </section>
      <section className="panel task-detail-panel">
        {!task ? <div className="empty-state"><ClipboardList size={22} /><h2>Select a task to review</h2><p>Saved task specifications, source evidence, pinned baselines, and version history appear here.</p></div> : <>
          <div className="panel-head"><div><span className="eyebrow">Draft · v{task.currentVersion}</span><h2>{task.title}</h2></div><span className="status amber">{task.status}</span></div>
          <div className="task-detail-editor">
            <label>Title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} /></label>
            <label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} /></label>
            <div className="field-grid"><label>Requirements<textarea value={requirements} onChange={event => setRequirements(event.target.value)} rows={5} /></label><label>Acceptance criteria<textarea value={acceptanceCriteria} onChange={event => setAcceptanceCriteria(event.target.value)} rows={5} /></label></div>
            <label>Constraints<textarea value={constraints} onChange={event => setConstraints(event.target.value)} rows={3} /></label>
            <div className="task-detail-section"><h3>Affected modules</h3><div className="task-module-tags">{task.affectedModules.map(module => <span className="analysis-tag" key={module}>{module}</span>)}</div></div>
            <div className="task-detail-section"><h3>Commit-pinned baseline</h3><div className="task-baseline-list">{task.baselineManifest.map(base => <div key={base.snapshotId}><code>{base.commitSha}</code><small>Snapshot {base.snapshotId} · analysis {base.analysisId}</small></div>)}</div></div>
            <div className="task-detail-section"><h3>Source evidence</h3>{task.evidence.map((item, index) => <div className="task-evidence-item" key={`${item.file_path}-${index}`}><b>{item.symbol || 'Source reference'}</b><code>{item.file_path}:{item.start_line}-{item.end_line}</code><small>Commit {item.commit_sha}</small></div>)}</div>
            <div className="task-detail-section"><h3><History size={15} /> Version history</h3><div className="task-version-list">{versions.map(version => <div key={version.id}><b>Version {version.version}</b><small>{new Date(version.createdAt).toLocaleString()}</small><span>{version.content.title}</span></div>)}</div></div>
            <div className="task-form-actions"><button className="primary-button" disabled={saving} onClick={saveChanges}>{saving ? 'Saving…' : `Save as version ${(task.currentVersion ?? 1) + 1}`}</button></div>
          </div>
        </>}
      </section>
    </div>
    {task && <section className="panel reference-workspace">
      <div className="panel-head"><div><span className="eyebrow">Reference implementation</span><h2>Generate and review a solution</h2></div>
        <button className="primary-button" disabled={referenceBusy || !task.generationId} onClick={generateReference}>
          {referenceBusy ? 'Working…' : 'Generate reference'}
        </button>
      </div>
      <p className="reference-disclaimer">
        Uses the same OpenRouter or Ollama provider as the task generation and the task’s pinned snapshot.
        Patches are applied to a separate copy of the pinned snapshot. Build and test commands run only after you start them, inside a constrained container.
      </p>
      <label className="reference-feedback">Generation feedback (optional)
        <textarea value={referenceFeedback} maxLength={2000} onChange={event => setReferenceFeedback(event.target.value)} placeholder="Use this to guide a revised reference after requesting changes." />
      </label>
      {referenceSolutions.length > 0 && <div className="reference-history">
        <label>Reference version
          <select value={selectedReference?.id ?? ''} onChange={event => {
            setSelectedReferenceId(event.target.value);
            setReviewNote(referenceSolutions.find(item => item.id === event.target.value)?.reviewNote ?? '');
          }}>
            {referenceSolutions.map(item => <option key={item.id} value={item.id}>v{item.version} · {item.status} · {item.provider}{item.model ? ` · ${item.model}` : ''}</option>)}
          </select>
        </label>
      </div>}
      {!selectedReference && <div className="empty-state compact">No reference generated yet. Generate one to create a file-by-file plan, patch, and public test files.</div>}
      {selectedReference && <>
        <div className="reference-status-row">
          <span className={`status ${selectedReference.status === 'approved' ? 'green' : selectedReference.status === 'failed' || selectedReference.status === 'rejected' ? 'amber' : 'gray'}`}>{selectedReference.status.replaceAll('_', ' ')}</span>
          <span>Task v{selectedReference.taskVersion} · {selectedReference.provider}{selectedReference.model ? ` · ${selectedReference.model}` : ''} · {new Date(selectedReference.createdAt).toLocaleString()}</span>
        </div>
        {selectedReference.errorMessage && <div className="inline-notice error" role="alert">{selectedReference.errorMessage}</div>}
        <p className="form-hint">
          Pinned snapshot patch check: {selectedReference.validation.patch_preflight === 'passed'
            ? 'passed before review'
            : selectedReference.validation.patch_preflight === 'failed'
              ? 'failed during generation'
              : selectedReference.validation.patch_preflight === 'not_run'
                ? 'not run yet'
                : 'not recorded for this reference version'}
        </p>
        {selectedReference.status === 'queued' || selectedReference.status === 'running'
          ? <p className="form-hint reference-disclaimer">Reference generation is running in the background. This panel refreshes automatically.</p>
          : selectedReference.status !== 'failed' && <>
            <details className="reference-artifact" open>
              <summary>Implementation plan ({selectedReference.implementationPlan?.length ?? 0} files)</summary>
              {selectedReference.implementationPlan?.map((item, index) => <article className="reference-plan-item" key={`${item.repository_id}-${item.file_path}-${index}`}>
                <h3><small>Repository {item.repository_id}</small> <code>{item.file_path}</code> <span className="status gray">{item.action}</span></h3>
                <p>{item.rationale}</p>
                <ol>{item.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol>
              </article>)}
            </details>
            <details className="reference-artifact">
              <summary>Proposed code patches ({selectedReference.patches?.length ?? 0} repositories)</summary>
              {selectedReference.patches?.map((patch, index) => <article className="reference-test-item" key={`${patch.repository_id}-${index}`}>
                <h3><code>Repository {patch.repository_id}</code></h3>
                <pre>{patch.patch_diff}</pre>
              </article>)}
            </details>
            <details className="reference-artifact">
              <summary>Generated public tests ({selectedReference.tests?.length ?? 0} files)</summary>
              {selectedReference.tests?.map((test, index) => <article className="reference-test-item" key={`${test.repository_id}-${test.file_path}-${index}`}>
                <h3><small>Repository {test.repository_id}</small> <code>{test.file_path}</code> <span className="status gray">{test.test_type}</span></h3>
                <p>{test.purpose}</p>
                <pre>{test.content}</pre>
              </article>)}
            </details>
            <section className="reference-apply">
              <h3>Apply and validate in a review workspace</h3>
              <p>
                Apply checks the diff against the pinned snapshot and writes changes to a separate copy. The original snapshot stays unchanged.
                Review the detected commands before starting automatic execution; setup and commands run in disposable containers.
              </p>
              <div className="task-form-actions">
                <button className="secondary-button" disabled={referenceBusy || selectedReference.status !== 'pending_review' || workspaceApplied} onClick={applyReference}>
                  {referenceBusy ? 'Applying…' : workspaceApplied ? 'Patches applied' : 'Apply patches to review workspace'}
                </button>
                {workspaceApplied && <a className="secondary-button" href={`${apiUrl}/references/${selectedReference.id}/workspace/archive`}>
                  Download workspace (.tar.gz)
                </a>}
              </div>
              {selectedReference.validation.apply_error && <div className="inline-notice error" role="alert">{selectedReference.validation.apply_error}</div>}
              {workspaceApplied && selectedReference.validation.workspace?.repositories?.map(repository => <div className="reference-command-list" key={repository.repository_id}>
                <b>{repository.repository_name}</b>
                <code>Folder: {repository.directory}</code>
                <span>Build: {repository.build_commands.length ? repository.build_commands.join(' · ') : 'No build script detected'}</span>
                <span>Tests: {repository.test_commands.length ? repository.test_commands.join(' · ') : 'No test script detected'}</span>
              </div>)}
              {workspaceApplied && <p className="form-hint">
                Execution uses a read-only container filesystem with a writable temporary workspace, no credentials, and network disabled for build/test commands. Dependency installation can use network only when enabled in backend configuration.
              </p>}
            </section>
            <section className="reference-validation">
              <h3>Automatic build and test validation</h3>
              <p>{workspaceApplied
                ? 'ForgeBench prepares detected dependencies, then records each setup/build/test command, exit code, duration, and bounded output.'
                : 'Apply the patches to an isolated review workspace before running build and test commands.'}</p>
              <div className="reference-validation-summary">
                <span>Build: <b>{selectedReference.validation.build ?? 'not_run'}</b></span>
                <span>Tests: <b>{selectedReference.validation.tests ?? 'not_run'}</b></span>
                <button className="secondary-button" disabled={referenceBusy || selectedReference.status !== 'pending_review' || !workspaceApplied || Boolean(activeValidationRun)} onClick={executeReferenceValidation}>
                  {activeValidationRun ? 'Validation running…' : latestValidationRun ? 'Run build and tests again' : 'Run build and tests'}
                </button>
              </div>
              {latestValidationRun && <div className="reference-execution-evidence">
                <div className="reference-execution-heading">
                  <b>Run {latestValidationRun.status}</b>
                  <span>{latestValidationRun.requested_at ? new Date(latestValidationRun.requested_at).toLocaleString() : ''}</span>
                  {latestValidationRun.environment?.image && <code>{latestValidationRun.environment.image}</code>}
                  {latestValidationRun.environment?.network_policy && <span>Dependency network: {latestValidationRun.environment.network_policy}</span>}
                </div>
                {latestValidationRun.error && <div className="inline-notice error" role="alert">{latestValidationRun.error}</div>}
                {latestValidationRun.repositories?.map((repository: Record<string, any>) => <details className="reference-repository-evidence" key={repository.repository_id} open>
                  <summary>{repository.repository_id} · {repository.status} · {repository.environment?.node_version ?? ''} {repository.environment?.python_version ?? ''}</summary>
                  {(['setup', 'build', 'tests'] as const).map(phase => {
                    const commands = (repository[phase] ?? []) as Array<Record<string, any>>;
                    return <section className="reference-command-evidence" key={phase}>
                      <h4>{phase} · {phase === 'setup' ? repository.setup_status : phase === 'build' ? repository.build_status : repository.test_status}</h4>
                      {commands.length === 0 && <p>No {phase === 'setup' ? 'environment setup' : `${phase} command`} detected.</p>}
                      {commands.map((command, index) => <details key={`${phase}-${index}`}>
                        <summary>
                          <span className={`status ${command.status === 'passed' ? 'green' : command.status === 'failed' ? 'amber' : 'gray'}`}>{command.status}</span>
                          <code>{(command.command ?? []).join(' ')}</code>
                          <span>exit {command.exit_code ?? '—'} · {command.duration_ms ?? 0} ms{command.timed_out ? ' · timed out' : ''}</span>
                        </summary>
                        {command.error && <p>{command.error}</p>}
                        {command.stdout && <pre>{command.stdout}{command.stdout_truncated ? '\n… earlier output omitted' : ''}</pre>}
                        {command.stderr && <pre>{command.stderr}{command.stderr_truncated ? '\n… earlier output omitted' : ''}</pre>}
                      </details>)}
                    </section>;
                  })}
                </details>)}
              </div>}
            </section>
            <section className="reference-review">
              <h3>Human review</h3>
              <label>Review note<textarea value={reviewNote} maxLength={2000} onChange={event => setReviewNote(event.target.value)} placeholder="Explain requested changes or the approval decision." /></label>
              <div className="task-form-actions">
                <button className="secondary-button" disabled={referenceBusy || selectedReference.status !== 'pending_review'} onClick={() => reviewReference('request_changes')}>Request changes</button>
                <button className="secondary-button" disabled={referenceBusy || selectedReference.status !== 'pending_review'} onClick={() => reviewReference('reject')}>Reject</button>
                <button className="primary-button" disabled={referenceBusy || selectedReference.status !== 'pending_review' || !workspaceApplied || selectedReference.validation.execution_mode !== 'automatic_container' || selectedReference.validation.build !== 'passed' || selectedReference.validation.tests !== 'passed'} onClick={() => reviewReference('approve')}>Approve reference</button>
              </div>
              {selectedReference.reviewNote && <p className="form-hint">Latest review note: {selectedReference.reviewNote}</p>}
            </section>
          </>}
      </>}
    </section>}
  </div>;
}

export default function App() {
  return <Shell />;
}
