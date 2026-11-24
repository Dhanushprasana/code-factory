import { useEffect, useState } from 'react';
import { Boxes, ChevronRight } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';

function ProjectRow({ name, repos, status }: { name: string; repos: string; status: string }) {
  return (
    <div className="project-row">
      <div className="project-icon">
        <Boxes size={18} />
      </div>
      <div className="row-main">
        <strong>{name}</strong>
        <span>{repos}</span>
      </div>
      <span className={`status ${status === 'Active' ? 'green' : 'gray'}`}>{status}</span>
      <ChevronRight size={16} />
    </div>
  );
}

export function Overview() {
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
        setProjects(
          projectItems.map(project => ({
            ...project,
            repositoryCount: repositoryItems.filter(item => item.projectId === project.id).length,
          })),
        );
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
        <div className="metric-card">
          <span>Projects</span>
          <strong>{dashboard?.totalProjects ?? '—'}</strong>
          <small>{dashboard ? 'Saved in this workspace' : 'Loading workspace data'}</small>
        </div>
        <div className="metric-card">
          <span>Connected repositories</span>
          <strong>{dashboard?.repositoriesConnected ?? '—'}</strong>
          <small>{dashboard ? 'Unique GitHub repositories' : 'Loading workspace data'}</small>
        </div>
        <div className="metric-card">
          <span>Coding agents</span>
          <strong>{agentsCount ?? '—'}</strong>
          <small>{agentsCount !== null ? 'Registered benchmark agents' : 'Loading agents'}</small>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Workspace data</span>
            <h2>Projects</h2>
          </div>
        </div>
        {projects.length ? (
          projects
            .slice(0, 5)
            .map(project => (
              <ProjectRow
                key={project.id}
                name={project.name}
                repos={`${project.repositoryCount} connected repositories`}
                status={project.status === 'active' ? 'Active' : project.status}
              />
            ))
        ) : (
          !error && (
            <div className="empty-state compact">
              {dashboard ? 'No projects yet. Create a project to connect repositories.' : 'Loading projects…'}
            </div>
          )
        )}
      </section>
    </div>
  );
}
