import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Boxes, ChevronRight, CircleGauge, FolderKanban, GitBranch, Plus, X,
} from 'lucide-react';

const nav = [
  { to: '/', label: 'Overview', icon: CircleGauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
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
  const [analysisView, setAnalysisView] = useState<'overview' | 'features' | 'structure' | 'modules'>('overview');
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
        if (result.status === 'queued' || result.status === 'running') {
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
                ] as const).map(([id, label, count]) => <button
                  type="button"
                  key={id}
                  id={`analysis-tab-${id}`}
                  role="tab"
                  aria-controls={`analysis-panel-${id}`}
                  aria-selected={analysisView === id}
                  className={`analysis-tab ${analysisView === id ? 'active' : ''}`}
                  onClick={() => setAnalysisView(id)}
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

export default function App() {
  return <Shell />;
}
