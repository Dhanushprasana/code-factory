import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import { FileTreeRows } from '../components/analysis/FileTreeRows';
import { ModuleMapSvg } from '../components/analysis/ModuleMapSvg';
import {
  buildFileTree,
  countTreeFiles,
  filterFileTree,
  findFileTreeNode,
} from '../components/analysis/utils';
import type {
  AnalysisRecord,
  FeatureArea,
  ModuleConnection,
  ProjectOption,
  ProjectRepository,
} from '../types';

export function AnalysisPage() {
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
        setProjectId(current => (items.some(item => item.id === current) ? current : (items[0]?.id ?? '')));
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load projects.');
      });
    return () => {
      active = false;
    };
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
        setRepositoryId(current =>
          items.some(item => item.repositoryId === current)
            ? current
            : items.some(item => item.repositoryId === searchParams.get('repositoryId'))
              ? searchParams.get('repositoryId')!
              : (items[0]?.repositoryId ?? ''),
        );
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load project repositories.');
      });
    return () => {
      active = false;
    };
  }, [projectId, searchParams]);

  useEffect(() => {
    if (!repositoryId) {
      setHistory([]);
      return;
    }
    let active = true;
    request<AnalysisRecord[]>(`${apiUrl}/repositories/${repositoryId}/analyses`)
      .then(items => {
        if (active) setHistory(items);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load analysis history.');
      });
    return () => {
      active = false;
    };
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
      setAnalysis(current => (current ? { ...current, ...result, contextStatus: 'running' } : result));
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
    .flatMap(([ecosystem, packages]) =>
      Array.isArray(packages) ? packages.map((item: any) => ({ ecosystem, ...item })) : [],
    )
    .slice(0, 40);
  const graph = report?.graph as { nodes?: any[]; edges?: any[] } | undefined;
  const features = Array.isArray(summary?.features) ? summary.features : [];
  const modules = Array.isArray(summary?.modules) ? summary.modules : [];
  const directoryTree = Array.isArray(report?.directory_tree) ? report.directory_tree : [];
  const apiRoutes = Array.isArray(summary?.api_routes) ? summary.api_routes : [];
  const databaseEntities = Array.isArray(summary?.database_entities) ? summary.database_entities : [];
  const testFiles = Array.isArray(report?.tests?.files) ? report.tests.files : [];
  const fileTree = useMemo(() => buildFileTree(directoryTree), [directoryTree]);
  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, fileQuery.trim().toLowerCase()),
    [fileTree, fileQuery],
  );
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
          routeCount: Number(
            module.api_route_count ?? apiRoutes.filter((route: any) => underModule(route.file_path)).length,
          ),
          entityCount: Number(
            module.database_entity_count ??
              databaseEntities.filter((entity: any) => underModule(entity.file_path)).length,
          ),
          testFileCount: Number(
            module.test_file_count ?? testFiles.filter((file: string) => underModule(file)).length,
          ),
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
    const layerMatches =
      featureLayer === 'all' ||
      (featureLayer === 'api' && area.routeCount > 0) ||
      (featureLayer === 'data' && area.entityCount > 0) ||
      (featureLayer === 'tests' && area.testFileCount > 0);
    return queryMatches && layerMatches;
  });

  const selectedArea = featureAreas.find(area => area.id === selectedAreaId) ?? featureAreas[0];
  const selectedTreeNode = findFileTreeNode(fileTree, selectedFilePath);
  const selectedRoutes =
    selectedTreeNode?.type === 'file' ? apiRoutes.filter((item: any) => item.file_path === selectedFilePath) : [];
  const selectedEntities =
    selectedTreeNode?.type === 'file'
      ? databaseEntities.filter((item: any) => item.file_path === selectedFilePath)
      : [];
  const selectedSymbols =
    selectedTreeNode?.type === 'file'
      ? (report?.symbols ?? []).filter((item: any) => item.file_path === selectedFilePath)
      : [];
  const selectedModule = featureAreas
    .filter(area => !area.documented && (selectedFilePath === area.path || selectedFilePath.startsWith(`${area.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];

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
        <div className="panel-head">
          <div>
            <span className="eyebrow">Analyze a pinned baseline</span>
            <h2>Select a project repository</h2>
          </div>
        </div>
        <div className="analysis-selectors">
          <label>
            Project
            <select
              value={projectId}
              onChange={event => {
                setProjectId(event.target.value);
                setRepositoryId('');
              }}
            >
              <option value="">Select a project</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Repository
            <select value={repositoryId} onChange={event => setRepositoryId(event.target.value)}>
              <option value="">Select a repository</option>
              {associations.map(item => (
                <option key={item.repositoryId} value={item.repositoryId}>
                  {item.repository.fullName} · {item.selectedCommitSha?.slice(0, 12) ?? 'no commit'}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            onClick={startAnalysis}
            disabled={starting || !selectedAssociation?.selectedCommitSha}
          >
            {starting ? 'Starting…' : 'Analyze snapshot'}
          </button>
        </div>
        {selectedAssociation && (
          <p className="analysis-hint">
            Analysis runs against {selectedAssociation.repository.fullName} at commit{' '}
            <code>{selectedAssociation.selectedCommitSha}</code>. Clone that snapshot from Projects first if it has not
            been cloned yet.
          </p>
        )}
      </section>

      {repositoryId && (
        <section className="panel analysis-history">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Saved reports</span>
              <h2>Analysis history</h2>
            </div>
            <span>{history.length} runs</span>
          </div>
          {history.length === 0 ? (
            <div className="empty-state compact">
              No analyses yet. Clone a repository snapshot, then start an analysis.
            </div>
          ) : (
            history.map(item => (
              <button
                className={`analysis-history-row ${analysisId === item.id ? 'selected' : ''}`}
                key={item.id}
                onClick={() => navigate(`/analysis/${item.id}`)}
              >
                <span
                  className={`status ${item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'amber'}`}
                >
                  {item.status}
                </span>
                <code>{item.commitSha.slice(0, 12)}</code>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <ChevronRight size={16} />
              </button>
            ))
          )}
        </section>
      )}

      {analysis && (
        <section className="analysis-report">
          <div className="analysis-repository-banner">
            <div className="analysis-banner-copy">
              <span
                className={`status ${analysis.status === 'completed' ? 'green' : analysis.status === 'failed' ? 'red' : 'amber'}`}
              >
                {analysis.status}
              </span>
              <h2>{selectedAssociation?.repository.fullName ?? 'Repository analysis'}</h2>
              <p>Commit-pinned repository analysis · Analyzer {analysis.analyzerVersion}</p>
            </div>
            <div className="analysis-repo-facts">
              <span>
                <b>Commit</b>
                {analysis.commitSha.slice(0, 12)}
              </span>
              <span>
                <b>Snapshot</b>
                {analysis.snapshotId.slice(0, 8)}
              </span>
              <span>
                <b>Files</b>
                {summary?.file_count?.toLocaleString() ?? '—'}
              </span>
              <span>
                <b>Analyzed</b>
                {new Date(analysis.updatedAt ?? analysis.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          {analysis.status === 'queued' || analysis.status === 'running' ? (
            <div className="panel analysis-progress">
              <strong>{analysis.status === 'queued' ? 'Analysis queued' : 'Analyzing repository…'}</strong>
              <p>
                The scanner is extracting repository structure and code relationships. This page will update
                automatically.
              </p>
            </div>
          ) : analysis.status === 'failed' ? (
            <div className="inline-notice error">{analysis.errorMessage ?? 'Repository analysis failed.'}</div>
          ) : (
            summary &&
            report && (
              <>
                {(analysis.warnings ?? []).length > 0 && (
                  <div className="inline-notice analysis-warnings">
                    <strong>Analyzer notes</strong>
                    <ul>
                      {analysis.warnings?.map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="analysis-metrics">
                  <div className="metric-card">
                    <span>Files discovered</span>
                    <strong>{summary.file_count ?? '—'}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Source files parsed</span>
                    <strong>{summary.analyzed_source_file_count ?? '—'}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Symbols</span>
                    <strong>{Array.isArray(report.symbols) ? report.symbols.length : '—'}</strong>
                  </div>
                  <div className="metric-card">
                    <span>API routes</span>
                    <strong>
                      {summary.api_route_count ??
                        (Array.isArray(summary.api_routes) ? summary.api_routes.length : 0)}
                    </strong>
                  </div>
                </div>
                <div className="analysis-tabs" role="tablist" aria-label="Repository analysis views">
                  {(
                    [
                      ['overview', 'Overview'],
                      ['features', 'Feature map', featureAreas.length],
                      ['structure', 'File structure'],
                      ['modules', 'Module map', featureAreas.length],
                      ['context', 'Context file'],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button
                      type="button"
                      key={id}
                      id={`analysis-tab-${id}`}
                      role="tab"
                      aria-controls={`analysis-panel-${id}`}
                      aria-selected={analysisView === id}
                      className={`analysis-tab ${analysisView === id ? 'active' : ''}`}
                      onClick={() => setAnalysisView(id as any)}
                    >
                      {label}
                      {typeof count === 'number' && <span>{count}</span>}
                    </button>
                  ))}
                </div>

                {analysisView === 'overview' && (
                  <div
                    id="analysis-panel-overview"
                    role="tabpanel"
                    aria-labelledby="analysis-tab-overview"
                    className="analysis-view-grid"
                  >
                    <section className="panel analysis-card">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">Repository overview</span>
                          <h2>Architecture at a glance</h2>
                        </div>
                        <span className="status gray">Commit pinned</span>
                      </div>
                      <div className="analysis-card-body">
                        <p className="analysis-summary-copy">
                          This report is grounded in the selected snapshot. Browse detected source areas, repository
                          files, and statically resolved module calls in the tabs above.
                        </p>
                        <div className="analysis-overview-metrics">
                          <div>
                            <b>{featureAreas.length}</b>
                            <span>source areas</span>
                          </div>
                          <div>
                            <b>{testFiles.length}</b>
                            <span>test files</span>
                          </div>
                          <div>
                            <b>{summary.database_entity_count ?? databaseEntities.length}</b>
                            <span>database entities</span>
                          </div>
                          <div>
                            <b>{summary.api_route_count ?? apiRoutes.length}</b>
                            <span>API routes</span>
                          </div>
                        </div>
                        <h3>Entry points</h3>
                        <div className="tag-list">
                          {(summary.entry_points ?? []).map((item: string) => (
                            <code className="analysis-tag" key={item}>
                              {item}
                            </code>
                          ))}
                        </div>
                        <h3>README sections</h3>
                        {features.length ? (
                          <div className="tag-list">
                            {features.slice(0, 18).map((item: any, index: number) => (
                              <span className="analysis-tag" key={`${item.name ?? item}-${index}`}>
                                {item.name ?? item}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p>No README headings were detected.</p>
                        )}
                      </div>
                    </section>
                    <section className="panel analysis-card">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">Technology</span>
                          <h2>Detected stack</h2>
                        </div>
                      </div>
                      <div className="analysis-card-body">
                        <h3>Languages</h3>
                        <div className="tag-list">
                          {(summary.language ?? []).map((language: string) => (
                            <span className="analysis-tag" key={language}>
                              {language}
                              {summary.language_file_counts?.[language]
                                ? ` · ${summary.language_file_counts[language]} files`
                                : ''}
                            </span>
                          ))}
                        </div>
                        <h3>Frameworks and data</h3>
                        <div className="tag-list">
                          {[...(summary.frameworks ?? []), ...(summary.database ?? []), ...(summary.orm ?? [])].map(
                            (item: string) => (
                              <span className="analysis-tag" key={item}>
                                {item}
                              </span>
                            ),
                          )}
                        </div>
                        <h3>Package managers</h3>
                        <p>{(summary.package_managers ?? []).join(', ') || 'Not detected'}</p>
                        <h3>Build and test commands</h3>
                        <p>
                          <strong>Build:</strong> {(summary.build_commands ?? []).join(', ') || 'Not detected'}
                        </p>
                        <p>
                          <strong>Test:</strong> {(summary.test_commands ?? []).join(', ') || 'Not detected'}
                        </p>
                      </div>
                    </section>
                    <section className="panel analysis-card">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">Manifest scan</span>
                          <h2>Dependencies</h2>
                        </div>
                        <span>{dependencies.length} shown</span>
                      </div>
                      <div className="analysis-table">
                        {dependencies.length ? (
                          dependencies.map((item: any) => (
                            <div className="analysis-table-row" key={`${item.ecosystem}-${item.name}`}>
                              <strong>{item.name}</strong>
                              <code>{item.version}</code>
                              <span>{item.ecosystem}</span>
                            </div>
                          ))
                        ) : (
                          <div className="empty-state compact">No supported dependency manifests found.</div>
                        )}
                      </div>
                    </section>
                    <section className="panel analysis-card">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">API and persistence</span>
                          <h2>Detected interfaces</h2>
                        </div>
                        <span>{apiRoutes.length + databaseEntities.length} details shown</span>
                      </div>
                      <div className="analysis-card-body">
                        <h3>API routes ({summary.api_route_count ?? apiRoutes.length})</h3>
                        {apiRoutes.slice(0, 12).map((route: any, index: number) => (
                          <div className="analysis-reference" key={`${route.file_path}-${route.line}-${index}`}>
                            <strong>
                              {route.method} {route.path}
                            </strong>
                            <code>
                              {route.file_path}:{route.line}
                            </code>
                          </div>
                        ))}
                        {!apiRoutes.length && <p>No route declarations were detected.</p>}
                        <h3>Database entities ({summary.database_entity_count ?? databaseEntities.length})</h3>
                        {databaseEntities.slice(0, 12).map((entity: any, index: number) => (
                          <div className="analysis-reference" key={`${entity.file_path}-${entity.line}-${index}`}>
                            <strong>{entity.name}</strong>
                            <code>
                              {entity.file_path}:{entity.line}
                            </code>
                          </div>
                        ))}
                        {!databaseEntities.length && <p>No entity declarations were detected.</p>}
                        <p className="analysis-hint">
                          Route and entity lists are bounded; see analyzer notes for truncation details.
                        </p>
                      </div>
                    </section>
                    <section className="panel analysis-card analysis-card-wide">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">Verification signals</span>
                          <h2>Test files and development notes</h2>
                        </div>
                        <span>{testFiles.length} test files</span>
                      </div>
                      <div className="analysis-card-body">
                        <div className="analysis-test-files">
                          {testFiles.slice(0, 24).map((file: string) => (
                            <span className="analysis-tag" key={file}>
                              {file}
                            </span>
                          ))}
                        </div>
                        {(report.potential_development_areas ?? []).map((item: string) => (
                          <p className="analysis-opportunity" key={item}>
                            {item}
                          </p>
                        ))}
                        <p className="analysis-hint">
                          Coverage is not inferred from test-file names. The analyzer lists test files and configured
                          commands but does not execute tests.
                        </p>
                      </div>
                    </section>
                  </div>
                )}

                {analysisView === 'features' && (
                  <section
                    id="analysis-panel-features"
                    role="tabpanel"
                    aria-labelledby="analysis-tab-features"
                    className="analysis-feature-view"
                  >
                    <div className="analysis-view-intro">
                      <div>
                        <span className="eyebrow">Source-grounded map</span>
                        <h2>Feature map</h2>
                        <p>
                          Areas are grouped from detected source folders. They are structural evidence, not AI-assigned
                          product capabilities.
                        </p>
                      </div>
                      <div className="analysis-feature-filters">
                        <input
                          type="search"
                          aria-label="Filter feature areas"
                          placeholder="Filter feature areas"
                          value={featureQuery}
                          onChange={event => setFeatureQuery(event.target.value)}
                        />
                        <select
                          aria-label="Filter feature areas by evidence"
                          value={featureLayer}
                          onChange={event => setFeatureLayer(event.target.value)}
                        >
                          <option value="all">All areas</option>
                          <option value="api">Has API routes</option>
                          <option value="data">Has entities</option>
                          <option value="tests">Has test files</option>
                        </select>
                      </div>
                    </div>
                    {featureAreas.some(area => area.documented) && (
                      <div className="inline-notice">
                        No source modules were detected. These fallback areas come from README headings only.
                      </div>
                    )}
                    <div className="analysis-feature-grid">
                      {visibleAreas.map(area => (
                        <button
                          type="button"
                          className={`analysis-feature-card ${selectedAreaId === area.id ? 'selected' : ''}`}
                          key={area.id}
                          onClick={() => selectFeatureArea(area.id)}
                        >
                          <span className="analysis-feature-card-heading">
                            <strong>{area.name}</strong>
                            <span className="status gray">{area.documented ? 'README' : 'Source module'}</span>
                          </span>
                          <code>{area.path}</code>
                          <div className="analysis-feature-stats">
                            <span>
                              <b>{area.fileCount}</b> files
                            </span>
                            <span>
                              <b>{area.routeCount}</b> routes
                            </span>
                            <span>
                              <b>{area.entityCount}</b> entities
                            </span>
                          </div>
                          <small>{area.testFileCount} test files · Select to inspect relationships</small>
                        </button>
                      ))}
                      {!visibleAreas.length && (
                        <div className="empty-state compact">No feature areas match these filters.</div>
                      )}
                    </div>
                    {features.length > 0 && (
                      <section className="panel analysis-card">
                        <div className="panel-head">
                          <div>
                            <span className="eyebrow">Repository documentation</span>
                            <h2>README headings</h2>
                          </div>
                          <span>Documentation signals only</span>
                        </div>
                        <div className="analysis-card-body">
                          <div className="tag-list">
                            {features.slice(0, 30).map((item: any, index: number) => (
                              <span className="analysis-tag" key={`${item.name ?? item}-${index}`}>
                                {item.name ?? item}
                              </span>
                            ))}
                          </div>
                        </div>
                      </section>
                    )}
                  </section>
                )}

                {analysisView === 'structure' && (
                  <div
                    id="analysis-panel-structure"
                    role="tabpanel"
                    aria-labelledby="analysis-tab-structure"
                    className="file-explorer-layout"
                  >
                    <section className="panel file-tree-panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">Pinned snapshot</span>
                          <h2>Project files</h2>
                        </div>
                        <span>{directoryTree.length.toLocaleString()} entries</span>
                      </div>
                      <div className="file-tree-search">
                        <input
                          type="search"
                          aria-label="Search snapshot files"
                          placeholder="Filter files and folders"
                          value={fileQuery}
                          onChange={event => setFileQuery(event.target.value)}
                        />
                      </div>
                      <div className="file-tree-list" role="tree" aria-label="Snapshot file structure">
                        {filteredFileTree.length ? (
                          <FileTreeRows
                            nodes={filteredFileTree}
                            depth={0}
                            query={fileQuery.trim()}
                            expandedPaths={expandedPaths}
                            selectedPath={selectedFilePath}
                            onToggle={toggleDirectory}
                            onSelect={node => setSelectedFilePath(node.path)}
                          />
                        ) : (
                          <div className="empty-state compact">No files match this search.</div>
                        )}
                      </div>
                    </section>
                    <section className="panel file-detail-panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">Snapshot item</span>
                          <h2>{selectedTreeNode?.name ?? 'Select a file or folder'}</h2>
                        </div>
                        <span className="status gray">
                          {selectedTreeNode?.type === 'directory'
                            ? 'Directory'
                            : selectedTreeNode
                              ? 'File'
                              : 'Overview'}
                        </span>
                      </div>
                      <div className="analysis-card-body">
                        {selectedTreeNode ? (
                          <>
                            <code className="file-detail-path">{selectedTreeNode.path}</code>
                            {selectedTreeNode.type === 'directory' ? (
                              <p>
                                {countTreeFiles(selectedTreeNode)} files are listed under this folder in the bounded
                                snapshot tree.
                              </p>
                            ) : (
                              <>
                                <p>
                                  {selectedModule
                                    ? `Source area: ${selectedModule.name} (${selectedModule.path}).`
                                    : 'This path is present in the selected pinned snapshot.'}{' '}
                                  {testFiles.includes(selectedFilePath) ? 'Detected as a test file.' : ''}
                                </p>
                                <h3>Detected symbols ({selectedSymbols.length})</h3>
                                {selectedSymbols.length ? (
                                  <div className="tag-list">
                                    {selectedSymbols.slice(0, 24).map((symbol: any, index: number) => (
                                      <span
                                        className="analysis-tag"
                                        key={`${symbol.name}-${symbol.start_line}-${index}`}
                                      >
                                        {symbol.kind} · {symbol.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p>No symbols were parsed from this file.</p>
                                )}
                                <h3>API routes</h3>
                                {selectedRoutes.length ? (
                                  selectedRoutes.map((route: any, index: number) => (
                                    <div
                                      className="analysis-reference"
                                      key={`${route.method}-${route.line}-${index}`}
                                    >
                                      <strong>
                                        {route.method} {route.path || '(path not resolved)'}
                                      </strong>
                                      <code>line {route.line}</code>
                                    </div>
                                  ))
                                ) : (
                                  <p>No route declarations detected in this file.</p>
                                )}
                                <h3>Database entities</h3>
                                {selectedEntities.length ? (
                                  selectedEntities.map((entity: any, index: number) => (
                                    <div
                                      className="analysis-reference"
                                      key={`${entity.name}-${entity.line}-${index}`}
                                    >
                                      <strong>{entity.name}</strong>
                                      <code>line {entity.line}</code>
                                    </div>
                                  ))
                                ) : (
                                  <p>No entity declarations detected in this file.</p>
                                )}
                              </>
                            )}
                            <p className="analysis-hint">
                              File contents are not displayed. This view only presents metadata extracted from the
                              pinned snapshot.
                            </p>
                          </>
                        ) : (
                          <p>Select a folder or file to inspect its location and analysis evidence.</p>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {analysisView === 'modules' && (
                  <section
                    id="analysis-panel-modules"
                    role="tabpanel"
                    aria-labelledby="analysis-tab-modules"
                    className="analysis-module-view"
                  >
                    <div className="analysis-view-intro">
                      <div>
                        <span className="eyebrow">Static relationships</span>
                        <h2>Module map</h2>
                        <p>
                          Directed edges show cross-module calls that the static parser could resolve. Missing edges do
                          not imply that modules are unrelated.
                        </p>
                      </div>
                      <span className="status gray">
                        {featureAreas.length} areas · {moduleConnections.length} cross-module links
                      </span>
                    </div>
                    <div className="module-map-layout">
                      <div className="panel module-map-canvas">
                        {featureAreas.length ? (
                          <ModuleMapSvg
                            areas={featureAreas}
                            connections={moduleConnections}
                            selectedAreaId={selectedArea?.id ?? ''}
                            onSelect={setSelectedAreaId}
                          />
                        ) : (
                          <div className="empty-state compact">
                            No modules or README areas are available for this snapshot.
                          </div>
                        )}
                        {featureAreas.length > 18 && (
                          <p className="analysis-hint">
                            The map displays the first 18 areas. Use the feature map to browse the full detected list.
                          </p>
                        )}
                        {!moduleConnections.length && (
                          <p className="analysis-hint">
                            No cross-module calls were statically resolved for this snapshot.
                          </p>
                        )}
                        <div className="module-map-legend">
                          <span>
                            <i className="containment-key" />
                            Folder containment
                          </span>
                          <span>
                            <i className="dependency-key" />
                            Resolved cross-module calls
                          </span>
                        </div>
                      </div>
                      <aside className="panel module-map-details">
                        {selectedArea ? (
                          <>
                            <span className="status gray">
                              {selectedArea.documented ? 'README heading' : 'Source module'}
                            </span>
                            <h3>{selectedArea.name}</h3>
                            <code>{selectedArea.path}</code>
                            <div className="module-detail-metrics">
                              <span>
                                <b>{selectedArea.fileCount}</b> files
                              </span>
                              <span>
                                <b>{selectedArea.testFileCount}</b> tests
                              </span>
                              <span>
                                <b>{selectedArea.routeCount}</b> routes
                              </span>
                            </div>
                            <h4>Resolved relationships</h4>
                            {moduleConnections
                              .filter(edge => edge.source === selectedArea.id || edge.target === selectedArea.id)
                              .map(edge => (
                                <div className="analysis-reference" key={`${edge.source}-${edge.target}`}>
                                  <strong>{edge.source === selectedArea.id ? 'Calls' : 'Called by'}</strong>
                                  <code>
                                    {edge.source === selectedArea.id ? edge.target : edge.source} · {edge.calls}
                                  </code>
                                </div>
                              ))}
                            {!moduleConnections.some(
                              edge => edge.source === selectedArea.id || edge.target === selectedArea.id,
                            ) && <p>No cross-module call edge was resolved for this area.</p>}
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setAnalysisView('features')}
                            >
                              Browse feature map
                            </button>
                          </>
                        ) : (
                          <p>Select a module node to inspect its evidence.</p>
                        )}
                      </aside>
                    </div>
                  </section>
                )}

                {analysisView === 'context' && (
                  <section
                    id="analysis-panel-context"
                    role="tabpanel"
                    aria-labelledby="analysis-tab-context"
                    className="analysis-context-view"
                  >
                    <div className="analysis-view-intro context-view-intro">
                      <div>
                        <span className="eyebrow">Repository Blueprint & Knowledge</span>
                        <h2>
                          Context file (<code>CONTEXT.md</code>)
                        </h2>
                        <p>
                          Comprehensive architecture, feature inventory, data models, and API interfaces synthesized
                          with NVIDIA Nemotron 3.5 Super VL.
                        </p>
                      </div>
                      <div className="context-view-actions">
                        {analysis.contextStatus === 'completed' && analysis.contextMarkdown && (
                          <>
                            <button type="button" className="secondary-button" onClick={() => setRawView(!rawView)}>
                              {rawView ? 'Rendered View' : 'Raw Markdown'}
                            </button>
                            <button type="button" className="secondary-button" onClick={copyContextMarkdown}>
                              {contextCopied ? 'Copied!' : 'Copy Markdown'}
                            </button>
                            <button type="button" className="secondary-button" onClick={downloadContextMarkdown}>
                              Download .md
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={generatingContext}
                              onClick={triggerContextGeneration}
                            >
                              Regenerate
                            </button>
                          </>
                        )}
                        {!analysis.contextMarkdown &&
                          analysis.contextStatus !== 'running' &&
                          analysis.contextStatus !== 'queued' && (
                            <button
                              type="button"
                              className="primary-button"
                              disabled={generatingContext}
                              onClick={triggerContextGeneration}
                            >
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
                              Analyzing grounded AST symbols, manifest dependencies, endpoints, and architecture using{' '}
                              <code>nvidia/nemotron-3.5-super-vl:free</code>. This view will update automatically.
                            </p>
                          </div>
                        </div>
                        <span className="status amber" style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                          In Progress
                        </span>
                      </div>
                    )}

                    {analysis.contextStatus === 'failed' && (
                      <div className="context-status-bar failed">
                        <div>
                          <strong>Context generation failed</strong>
                          <p style={{ margin: '3px 0 0', fontSize: '11px' }}>
                            {analysis.contextError || 'An error occurred while generating repository context.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={triggerContextGeneration}
                          disabled={generatingContext}
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {analysis.contextMarkdown ? (
                      <div className="context-markdown-container">
                        <div className="context-markdown-toolbar">
                          <span>
                            <strong>CONTEXT.md</strong> &bull; Generated with NVIDIA Nemotron 3.5 Super VL
                          </span>
                          <span>
                            {analysis.contextMarkdown.length} characters &bull; ~
                            {Math.round(analysis.contextMarkdown.length / 4)} tokens
                          </span>
                        </div>
                        {rawView ? (
                          <textarea className="context-markdown-raw" readOnly value={analysis.contextMarkdown} />
                        ) : (
                          <div className="context-markdown-body">
                            <pre
                              style={{
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                margin: 0,
                                fontFamily: 'inherit',
                                background: 'transparent',
                                color: 'inherit',
                                padding: 0,
                              }}
                            >
                              {analysis.contextMarkdown}
                            </pre>
                          </div>
                        )}
                      </div>
                    ) : (
                      analysis.contextStatus !== 'running' &&
                      analysis.contextStatus !== 'queued' && (
                        <div className="empty-state compact" style={{ padding: '40px 20px', textAlign: 'center' }}>
                          <p style={{ fontSize: '14px', fontWeight: 600, color: '#344054', marginBottom: '8px' }}>
                            No context file generated yet for this snapshot.
                          </p>
                          <p style={{ fontSize: '12px', color: '#667085', maxWidth: '480px', margin: '0 auto 16px' }}>
                            Generate a comprehensive, single-file Markdown blueprint containing executive summary, system
                            design, feature matrix, data schemas, and runtime instructions.
                          </p>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={triggerContextGeneration}
                            disabled={generatingContext}
                          >
                            Generate Context File (.md)
                          </button>
                        </div>
                      )
                    )}
                  </section>
                )}
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
