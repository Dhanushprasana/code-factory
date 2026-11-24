import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, History, Sparkles } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import type { ProjectOption, SavedTask } from '../types';

export function TaskLibraryPage() {
  const navigate = useNavigate();
  const { taskId } = useParams();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState<SavedTask[]>([]);
  const [task, setTask] = useState<SavedTask | null>(null);
  const [versions, setVersions] = useState<
    Array<{ id: string; version: number; content: Record<string, any>; createdAt: string }>
  >([]);
  const [verifyingSolution, setVerifyingSolution] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [constraints, setConstraints] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<ProjectOption[]>(`${apiUrl}/projects`)
      .then(setProjects)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load projects.'));
  }, []);

  useEffect(() => {
    const url = projectId ? `${apiUrl}/projects/${projectId}/tasks` : `${apiUrl}/tasks`;
    request<SavedTask[]>(url)
      .then(setTasks)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load tasks.'));
  }, [projectId]);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setVersions([]);
      return;
    }
    Promise.all([
      request<SavedTask>(`${apiUrl}/tasks/${taskId}`),
      request<Array<{ id: string; version: number; content: Record<string, any>; createdAt: string }>>(
        `${apiUrl}/tasks/${taskId}/versions`,
      ),
    ])
      .then(([loaded, history]) => {
        setTask(loaded);
        setProjectId(loaded.projectId);
        setVersions(history);
        setTitle(loaded.title);
        setDescription(loaded.description);
        setRequirements(loaded.requirements.join('\n'));
        setAcceptanceCriteria(loaded.acceptanceCriteria.join('\n'));
        setConstraints(loaded.constraints.join('\n'));
        setError('');
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load task details.'));
  }, [taskId]);

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
          requirements: requirements
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean),
          acceptanceCriteria: acceptanceCriteria
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean),
          constraints: constraints
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean),
        }),
      });
      setTask(updated);
      const history = await request<typeof versions>(`${apiUrl}/tasks/${task.id}/versions`);
      setVersions(history);
      setNotice(`Saved task version ${updated.currentVersion}.`);
      setTasks(current => current.map(item => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save task changes.');
    } finally {
      setSaving(false);
    }
  };

  const verifySolution = async () => {
    if (!task) return;
    setVerifyingSolution(true);
    setError('');
    setNotice('');
    try {
      const updated = await request<SavedTask>(`${apiUrl}/tasks/${task.id}/verify-solution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      setTask(updated);
      setTasks(current => current.map(item => (item.id === updated.id ? updated : item)));
      if (updated.harborVerification?.status === 'passed') {
        setNotice('Harbor verification passed! solve.sh fix applied cleanly and test.sh reward = 1.0.');
      } else {
        setError(`Harbor verification failed: ${updated.harborVerification?.error || 'solve.sh or test.sh failed'}.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify solution.');
    } finally {
      setVerifyingSolution(false);
    }
  };

  return (
    <div className="page task-library-page">
      <PageHeader
        eyebrow="Task workbench"
        title={task ? 'Task review' : 'Task library'}
        action={
          <button className="primary-button" onClick={() => navigate('/tasks/new')}>
            <Sparkles size={15} /> New task
          </button>
        }
      />
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      <div className="project-picker">
        <label htmlFor="task-library-project">Project</label>
        <select
          id="task-library-project"
          value={projectId}
          onChange={event => {
            setProjectId(event.target.value);
            if (taskId) navigate('/tasks');
          }}
        >
          <option value="">All projects</option>
          {projects.map(project => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <div className="task-library-layout">
        <section className="panel task-list-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Saved task specifications</span>
              <h2>
                {tasks.length} task{tasks.length === 1 ? '' : 's'}
              </h2>
            </div>
          </div>
          {tasks.length ? (
            tasks.map(item => (
              <button
                type="button"
                className={`task-library-row ${task?.id === item.id ? 'selected' : ''}`}
                key={item.id}
                onClick={() => navigate(`/tasks/${item.id}`)}
              >
                <span>
                  <b>{item.title}</b>
                  <small>
                    {projects.find(project => project.id === item.projectId)?.name ?? 'Project'} ·{' '}
                    {item.category.replaceAll('_', ' ')}
                  </small>
                  <small>{item.baselineManifest.map(base => base.commitSha.slice(0, 10)).join(', ')}</small>
                </span>
                <span className="task-row-meta">
                  <span className={`status ${item.status === 'draft' ? 'amber' : 'gray'}`}>{item.status}</span>
                  <small>v{item.currentVersion}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="empty-state compact">
              No saved tasks yet. Generate and review a task draft to populate the library.
            </div>
          )}
        </section>
        <section className="panel task-detail-panel">
          {!task ? (
            <div className="empty-state">
              <ClipboardList size={22} />
              <h2>Select a task to review</h2>
              <p>Saved task specifications, source evidence, pinned baselines, and version history appear here.</p>
            </div>
          ) : (
            <>
              <div className="panel-head">
                <div>
                  <span className="eyebrow">Draft · v{task.currentVersion}</span>
                  <h2>{task.title}</h2>
                </div>
                <span className="status amber">{task.status}</span>
              </div>
              <div className="task-detail-editor">
                <label>
                  Title
                  <input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} />
                </label>
                <label>
                  Description
                  <textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} />
                </label>
                <div className="field-grid">
                  <label>
                    Requirements
                    <textarea value={requirements} onChange={event => setRequirements(event.target.value)} rows={5} />
                  </label>
                  <label>
                    Acceptance criteria
                    <textarea
                      value={acceptanceCriteria}
                      onChange={event => setAcceptanceCriteria(event.target.value)}
                      rows={5}
                    />
                  </label>
                </div>
                <label>
                  Constraints
                  <textarea value={constraints} onChange={event => setConstraints(event.target.value)} rows={3} />
                </label>
                <div className="task-detail-section">
                  <h3>Affected modules</h3>
                  <div className="task-module-tags">
                    {task.affectedModules.map(module => (
                      <span className="analysis-tag" key={module}>
                        {module}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="task-detail-section">
                  <h3>Commit-pinned baseline</h3>
                  <div className="task-baseline-list">
                    {task.baselineManifest.map(base => (
                      <div key={base.snapshotId}>
                        <code>{base.commitSha}</code>
                        <small>
                          Snapshot {base.snapshotId} · analysis {base.analysisId}
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="task-detail-section">
                  <h3>Source evidence</h3>
                  {task.evidence.map((item, index) => (
                    <div className="task-evidence-item" key={`${item.file_path}-${index}`}>
                      <b>{item.symbol || 'Source reference'}</b>
                      <code>
                        {item.file_path}:{item.start_line}-{item.end_line}
                      </code>
                      <small>Commit {item.commit_sha}</small>
                    </div>
                  ))}
                </div>
                {task.harborFiles && (
                  <div className="task-detail-section">
                    <h3>Harbor Task Package</h3>
                    {task.harborPackagePath && (
                      <p className="form-hint" style={{ marginBottom: 8 }}>
                        Stored in Docker volume: <code>{task.harborPackagePath}</code>
                      </p>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <details className="reference-artifact">
                        <summary>instruction.md</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 250, overflow: 'auto', fontSize: 12, padding: 12, background: '#101828', color: '#eaecf0' }}>
                          {task.harborFiles.instruction_md}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>task.toml (Harbor v1.4)</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12, padding: 12, background: '#101828', color: '#eaecf0' }}>
                          {task.harborFiles.task_toml}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>environment/Dockerfile</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12, padding: 12, background: '#101828', color: '#eaecf0' }}>
                          {task.harborFiles.dockerfile}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>solution/solve.sh</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12, padding: 12, background: '#101828', color: '#eaecf0' }}>
                          {task.harborFiles.solve_sh}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>tests/test.sh (verifier)</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12, padding: 12, background: '#101828', color: '#eaecf0' }}>
                          {task.harborFiles.test_sh}
                        </pre>
                      </details>
                    </div>
                  </div>
                )}
                <div className="task-detail-section">
                  <h3>
                    <History size={15} /> Version history
                  </h3>
                  <div className="task-version-list">
                    {versions.map(version => (
                      <div key={version.id}>
                        <b>Version {version.version}</b>
                        <small>{new Date(version.createdAt).toLocaleString()}</small>
                        <span>{version.content.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="task-form-actions">
                  <button className="primary-button" disabled={saving} onClick={saveChanges}>
                    {saving ? 'Saving…' : `Save as version ${(task.currentVersion ?? 1) + 1}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {task && (
        <section className="panel reference-workspace">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Harbor benchmark verification</span>
              <h2>Verify solution (solve.sh & test.sh)</h2>
            </div>
            <button
              className="primary-button"
              disabled={verifyingSolution || !task.harborFiles?.solve_sh || !task.harborFiles?.test_sh}
              onClick={verifySolution}
            >
              {verifyingSolution ? 'Verifying solution…' : 'Verify solution'}
            </button>
          </div>
          <p className="reference-disclaimer">
            Runs automated Harbor benchmark verification: creates an isolated copy of the pinned snapshot repository,
            applies the AI-generated <code>solve.sh</code> patch, runs <code>test.sh</code>, and evaluates the reward.
          </p>

          {!task.harborVerification ? (
            <div className="empty-state compact">
              {task.harborFiles?.solve_sh && task.harborFiles?.test_sh
                ? 'No verification run yet. Click "Verify solution" to test solve.sh against test.sh.'
                : 'This task does not contain Harbor solve.sh or test.sh artifacts to verify.'}
            </div>
          ) : (
            <div className="harbor-verification-results">
              <div className="reference-status-row">
                <span
                  className={`status ${task.harborVerification.status === 'passed' ? 'green' : 'amber'}`}
                  style={{ fontWeight: 600, fontSize: '0.95rem', padding: '4px 10px' }}
                >
                  {task.harborVerification.status === 'passed'
                    ? `PASSED (Reward: ${task.harborVerification.reward.toFixed(1)})`
                    : `FAILED (Reward: ${task.harborVerification.reward.toFixed(1)})`}
                </span>
                <span>
                  Verified at: {new Date(task.harborVerification.verifiedAt).toLocaleString()}
                </span>
              </div>

              {task.harborVerification.error && (
                <div className="inline-notice error" role="alert" style={{ marginTop: '1rem' }}>
                  {task.harborVerification.error}
                </div>
              )}

              {task.harborVerification.solveResult && (
                <details className="reference-artifact" open style={{ marginTop: '1rem' }}>
                  <summary>
                    solve.sh execution log (Exit code: {task.harborVerification.solveResult.exitCode}
                    {task.harborVerification.solveResult.durationMs ? ` · ${task.harborVerification.solveResult.durationMs}ms` : ''})
                  </summary>
                  <pre
                    style={{
                      background: '#101828',
                      color: '#eaecf0',
                      padding: '1rem',
                      borderRadius: '6px',
                      overflowX: 'auto',
                      maxHeight: '350px',
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {task.harborVerification.solveResult.output || '(no stdout/stderr output)'}
                  </pre>
                </details>
              )}

              {task.harborVerification.testResult && (
                <details className="reference-artifact" open style={{ marginTop: '1rem' }}>
                  <summary>
                    test.sh verifier log (Exit code: {task.harborVerification.testResult.exitCode}
                    {task.harborVerification.testResult.durationMs ? ` · ${task.harborVerification.testResult.durationMs}ms` : ''})
                  </summary>
                  <pre
                    style={{
                      background: '#101828',
                      color: '#eaecf0',
                      padding: '1rem',
                      borderRadius: '6px',
                      overflowX: 'auto',
                      maxHeight: '350px',
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {task.harborVerification.testResult.output || '(no stdout/stderr output)'}
                  </pre>
                </details>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
