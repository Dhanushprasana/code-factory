import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Plus } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import { AddRepositoryModal } from '../components/modals/AddRepositoryModal';

export function Projects({ onNewProject }: { onNewProject: () => void }) {
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
      setProjectId(current => (result.some(project => project.id === current) ? current : (result[0]?.id ?? '')));
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
    if (
      !window.confirm(
        `Disconnect ${association.repository.fullName} from this project? The repository record and snapshots will be kept.`,
      )
    )
      return;
    try {
      await request(`${apiUrl}/projects/${projectId}/repositories/${association.repositoryId}`, { method: 'DELETE' });
      setComponents(items => items.filter(item => item.id !== association.id));
      setNotice(`${association.repository.fullName} disconnected from this project.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect repository.');
    }
  };

  const deleteProject = async () => {
    if (
      !selectedProject ||
      !window.confirm(
        `Delete "${selectedProject.name}"? Project links will be removed; repository records and snapshots are retained.`,
      )
    )
      return;
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
      <PageHeader
        eyebrow="Portfolio"
        title="Projects"
        action={
          <button className="primary-button" onClick={onNewProject}>
            <Plus size={17} /> Create project
          </button>
        }
      />
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      {projects.length === 0 ? (
        <section className="panel empty-state">
          <h2>Create a project to get started</h2>
          <p>Projects group repositories and their pinned commit baselines.</p>
          <button className="primary-button" onClick={onNewProject}>
            <Plus size={17} /> Create project
          </button>
        </section>
      ) : (
        <>
          <div className="project-picker">
            <label htmlFor="project-select">Project</label>
            <select id="project-select" value={projectId} onChange={event => setProjectId(event.target.value)}>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="project-detail">
            <aside className="project-summary">
              <div className="project-logo">{(selectedProject?.name ?? 'P').slice(0, 2).toUpperCase()}</div>
              <h2>{selectedProject?.name}</h2>
              <p>{selectedProject?.description || 'Project repositories and immutable baselines.'}</p>
              <div className="summary-meta">
                <span>
                  Components <strong>{components.length}</strong>
                </span>
                <span>
                  Commits pinned <strong>{components.filter(item => item.selectedCommitSha).length}</strong>
                </span>
              </div>
              <button className="secondary-button danger-button" onClick={deleteProject}>
                Delete project
              </button>
            </aside>
            <section className="component-panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Project components</span>
                  <h2>Repository baselines</h2>
                </div>
                <div className="panel-actions">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      request<{ url: string }>(`${apiUrl}/github/install-url`)
                        .then(result => window.open(result.url, '_blank', 'noopener,noreferrer'))
                        .catch(reason => setError(reason.message))
                    }
                  >
                    Connect GitHub
                  </button>
                  <button className="secondary-button" onClick={() => setRepoModal(true)}>
                    <Plus size={16} /> Add repository
                  </button>
                </div>
              </div>
              {components.length === 0 && (
                <div className="empty-state compact">No repositories connected to this project yet.</div>
              )}
              {components.map(association => (
                <div className="repository-row" key={association.id}>
                  <div className="repo-icon">
                    <GitBranch size={18} />
                  </div>
                  <div className="row-main">
                    <strong>{association.repository.fullName}</strong>
                    <span>
                      {association.repoRole} · branch{' '}
                      {association.selectedBranch || association.repository.defaultBranch}
                    </span>
                  </div>
                  <code title={association.selectedCommitSha}>
                    {association.selectedCommitSha?.slice(0, 12) ?? 'No commit'}
                  </code>
                  <button className="secondary-button" onClick={() => clone(association)}>
                    Clone snapshot
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!association.selectedCommitSha}
                    onClick={() =>
                      navigate(
                        `/analysis?projectId=${encodeURIComponent(projectId)}&repositoryId=${encodeURIComponent(association.repositoryId)}`,
                      )
                    }
                  >
                    Analyze
                  </button>
                  <button className="secondary-button danger-button" onClick={() => removeRepository(association)}>
                    Remove
                  </button>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {repoModal && projectId && (
        <AddRepositoryModal
          projectId={projectId}
          onClose={() => setRepoModal(false)}
          onAdded={() => {
            setRepoModal(false);
            request<any[]>(`${apiUrl}/projects/${projectId}/repositories`)
              .then(setComponents)
              .catch(reason => setError(reason.message));
          }}
        />
      )}
    </div>
  );
}
