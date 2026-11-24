import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, History, Sparkles } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import type { ProjectOption, ReferenceSolution, SavedTask } from '../types';

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
      setReferenceSolutions([]);
      setSelectedReferenceId('');
      setReferenceFeedback('');
      setReviewNote('');
      return;
    }
    Promise.all([
      request<SavedTask>(`${apiUrl}/tasks/${taskId}`),
      request<Array<{ id: string; version: number; content: Record<string, any>; createdAt: string }>>(
        `${apiUrl}/tasks/${taskId}/versions`,
      ),
      request<ReferenceSolution[]>(`${apiUrl}/tasks/${taskId}/references`),
    ])
      .then(([loaded, history, references]) => {
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
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load task details.'));
  }, [taskId]);

  useEffect(() => {
    if (
      !taskId ||
      !referenceSolutions.some(
        item =>
          item.status === 'queued' ||
          item.status === 'running' ||
          item.validation.execution_runs?.some(run => run.status === 'queued' || run.status === 'running'),
      )
    )
      return;
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
      setReferenceSolutions(current => current.map(item => (item.id === updated.id ? updated : item)));
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
      const updated = await request<ReferenceSolution>(
        `${apiUrl}/references/${selectedReference.id}/validation/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      setReferenceSolutions(current => current.map(item => (item.id === updated.id ? updated : item)));
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
      setReferenceSolutions(current => current.map(item => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save reference review.');
    } finally {
      setReferenceBusy(false);
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
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                          {task.harborFiles.instruction_md}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>task.toml (Harbor v1.4)</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                          {task.harborFiles.task_toml}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>environment/Dockerfile</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                          {task.harborFiles.dockerfile}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>solution/solve.sh</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                          {task.harborFiles.solve_sh}
                        </pre>
                      </details>
                      <details className="reference-artifact">
                        <summary>tests/test.sh (verifier)</summary>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
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
              <span className="eyebrow">Reference implementation</span>
              <h2>Generate and review a solution</h2>
            </div>
            <button
              className="primary-button"
              disabled={referenceBusy || !task.generationId}
              onClick={generateReference}
            >
              {referenceBusy ? 'Working…' : 'Generate reference'}
            </button>
          </div>
          <p className="reference-disclaimer">
            Uses the same OpenRouter or Ollama provider as the task generation and the task’s pinned snapshot. Patches
            are applied to a separate copy of the pinned snapshot. Build and test commands run only after you start them,
            inside a constrained container.
          </p>
          <label className="reference-feedback">
            Generation feedback (optional)
            <textarea
              value={referenceFeedback}
              maxLength={2000}
              onChange={event => setReferenceFeedback(event.target.value)}
              placeholder="Use this to guide a revised reference after requesting changes."
            />
          </label>
          {referenceSolutions.length > 0 && (
            <div className="reference-history">
              <label>
                Reference version
                <select
                  value={selectedReference?.id ?? ''}
                  onChange={event => {
                    setSelectedReferenceId(event.target.value);
                    setReviewNote(referenceSolutions.find(item => item.id === event.target.value)?.reviewNote ?? '');
                  }}
                >
                  {referenceSolutions.map(item => (
                    <option key={item.id} value={item.id}>
                      v{item.version} · {item.status} · {item.provider}
                      {item.model ? ` · ${item.model}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {!selectedReference && (
            <div className="empty-state compact">
              No reference generated yet. Generate one to create a file-by-file plan, patch, and public test files.
            </div>
          )}
          {selectedReference && (
            <>
              <div className="reference-status-row">
                <span
                  className={`status ${selectedReference.status === 'approved' ? 'green' : selectedReference.status === 'failed' || selectedReference.status === 'rejected' ? 'amber' : 'gray'}`}
                >
                  {selectedReference.status.replaceAll('_', ' ')}
                </span>
                <span>
                  Task v{selectedReference.taskVersion} · {selectedReference.provider}
                  {selectedReference.model ? ` · ${selectedReference.model}` : ''} ·{' '}
                  {new Date(selectedReference.createdAt).toLocaleString()}
                </span>
              </div>
              {selectedReference.errorMessage && (
                <div className="inline-notice error" role="alert">
                  {selectedReference.errorMessage}
                </div>
              )}
              <p className="form-hint">
                Pinned snapshot patch check:{' '}
                {selectedReference.validation.patch_preflight === 'passed'
                  ? 'passed before review'
                  : selectedReference.validation.patch_preflight === 'failed'
                    ? 'failed during generation'
                    : selectedReference.validation.patch_preflight === 'not_run'
                      ? 'not run yet'
                      : 'not recorded for this reference version'}
              </p>
              {selectedReference.status === 'queued' || selectedReference.status === 'running' ? (
                <p className="form-hint reference-disclaimer">
                  Reference generation is running in the background. This panel refreshes automatically.
                </p>
              ) : (
                selectedReference.status !== 'failed' && (
                  <>
                    <details className="reference-artifact" open>
                      <summary>Implementation plan ({selectedReference.implementationPlan?.length ?? 0} files)</summary>
                      {selectedReference.implementationPlan?.map((item, index) => (
                        <article
                          className="reference-plan-item"
                          key={`${item.repository_id}-${item.file_path}-${index}`}
                        >
                          <h3>
                            <small>Repository {item.repository_id}</small> <code>{item.file_path}</code>{' '}
                            <span className="status gray">{item.action}</span>
                          </h3>
                          <p>{item.rationale}</p>
                          <ol>
                            {item.steps.map((step, stepIndex) => (
                              <li key={stepIndex}>{step}</li>
                            ))}
                          </ol>
                        </article>
                      ))}
                    </details>
                    <details className="reference-artifact">
                      <summary>
                        Proposed code patches ({selectedReference.patches?.length ?? 0} repositories)
                      </summary>
                      {selectedReference.patches?.map((patch, index) => (
                        <article className="reference-test-item" key={`${patch.repository_id}-${index}`}>
                          <h3>
                            <code>Repository {patch.repository_id}</code>
                          </h3>
                          <pre>{patch.patch_diff}</pre>
                        </article>
                      ))}
                    </details>
                    <details className="reference-artifact">
                      <summary>Generated public tests ({selectedReference.tests?.length ?? 0} files)</summary>
                      {selectedReference.tests?.map((test, index) => (
                        <article
                          className="reference-test-item"
                          key={`${test.repository_id}-${test.file_path}-${index}`}
                        >
                          <h3>
                            <small>Repository {test.repository_id}</small> <code>{test.file_path}</code>{' '}
                            <span className="status gray">{test.test_type}</span>
                          </h3>
                          <p>{test.purpose}</p>
                          <pre>{test.content}</pre>
                        </article>
                      ))}
                    </details>
                    <section className="reference-apply">
                      <h3>Apply and validate in a review workspace</h3>
                      <p>
                        Apply checks the diff against the pinned snapshot and writes changes to a separate copy. The
                        original snapshot stays unchanged. Review the detected commands before starting automatic
                        execution; setup and commands run in disposable containers.
                      </p>
                      <div className="task-form-actions">
                        <button
                          className="secondary-button"
                          disabled={
                            referenceBusy || selectedReference.status !== 'pending_review' || workspaceApplied
                          }
                          onClick={applyReference}
                        >
                          {referenceBusy
                            ? 'Applying…'
                            : workspaceApplied
                              ? 'Patches applied'
                              : 'Apply patches to review workspace'}
                        </button>
                        {workspaceApplied && (
                          <a
                            className="secondary-button"
                            href={`${apiUrl}/references/${selectedReference.id}/workspace/archive`}
                          >
                            Download workspace (.tar.gz)
                          </a>
                        )}
                      </div>
                      {selectedReference.validation.apply_error && (
                        <div className="inline-notice error" role="alert">
                          {selectedReference.validation.apply_error}
                        </div>
                      )}
                      {workspaceApplied &&
                        selectedReference.validation.workspace?.repositories?.map(repository => (
                          <div className="reference-command-list" key={repository.repository_id}>
                            <b>{repository.repository_name}</b>
                            <code>Folder: {repository.directory}</code>
                            <span>
                              Build:{' '}
                              {repository.build_commands.length
                                ? repository.build_commands.join(' · ')
                                : 'No build script detected'}
                            </span>
                            <span>
                              Tests:{' '}
                              {repository.test_commands.length
                                ? repository.test_commands.join(' · ')
                                : 'No test script detected'}
                            </span>
                          </div>
                        ))}
                      {workspaceApplied && (
                        <p className="form-hint">
                          Execution uses a read-only container filesystem with a writable temporary workspace, no
                          credentials, and network disabled for build/test commands. Dependency installation can use
                          network only when enabled in backend configuration.
                        </p>
                      )}
                    </section>
                    <section className="reference-validation">
                      <h3>Automatic build and test validation</h3>
                      <p>
                        {workspaceApplied
                          ? 'ForgeBench prepares detected dependencies, then records each setup/build/test command, exit code, duration, and bounded output.'
                          : 'Apply the patches to an isolated review workspace before running build and test commands.'}
                      </p>
                      <div className="reference-validation-summary">
                        <span>
                          Build: <b>{selectedReference.validation.build ?? 'not_run'}</b>
                        </span>
                        <span>
                          Tests: <b>{selectedReference.validation.tests ?? 'not_run'}</b>
                        </span>
                        <button
                          className="secondary-button"
                          disabled={
                            referenceBusy ||
                            selectedReference.status !== 'pending_review' ||
                            !workspaceApplied ||
                            Boolean(activeValidationRun)
                          }
                          onClick={executeReferenceValidation}
                        >
                          {activeValidationRun
                            ? 'Validation running…'
                            : latestValidationRun
                              ? 'Run build and tests again'
                              : 'Run build and tests'}
                        </button>
                      </div>
                      {latestValidationRun && (
                        <div className="reference-execution-evidence">
                          <div className="reference-execution-heading">
                            <b>Run {latestValidationRun.status}</b>
                            <span>
                              {latestValidationRun.requested_at
                                ? new Date(latestValidationRun.requested_at).toLocaleString()
                                : ''}
                            </span>
                            {latestValidationRun.environment?.image && (
                              <code>{latestValidationRun.environment.image}</code>
                            )}
                            {latestValidationRun.environment?.network_policy && (
                              <span>Dependency network: {latestValidationRun.environment.network_policy}</span>
                            )}
                          </div>
                          {latestValidationRun.error && (
                            <div className="inline-notice error" role="alert">
                              {latestValidationRun.error}
                            </div>
                          )}
                          {latestValidationRun.repositories?.map((repository: Record<string, any>) => (
                            <details
                              className="reference-repository-evidence"
                              key={repository.repository_id}
                              open
                            >
                              <summary>
                                {repository.repository_id} · {repository.status} ·{' '}
                                {repository.environment?.node_version ?? ''}{' '}
                                {repository.environment?.python_version ?? ''}
                              </summary>
                              {(['setup', 'build', 'tests'] as const).map(phase => {
                                const commands = (repository[phase] ?? []) as Array<Record<string, any>>;
                                return (
                                  <section className="reference-command-evidence" key={phase}>
                                    <h4>
                                      {phase} ·{' '}
                                      {phase === 'setup'
                                        ? repository.setup_status
                                        : phase === 'build'
                                          ? repository.build_status
                                          : repository.test_status}
                                    </h4>
                                    {commands.length === 0 && (
                                      <p>No {phase === 'setup' ? 'environment setup' : `${phase} command`} detected.</p>
                                    )}
                                    {commands.map((command, index) => (
                                      <details key={`${phase}-${index}`}>
                                        <summary>
                                          <span
                                            className={`status ${command.status === 'passed' ? 'green' : command.status === 'failed' ? 'amber' : 'gray'}`}
                                          >
                                            {command.status}
                                          </span>
                                          <code>{(command.command ?? []).join(' ')}</code>
                                          <span>
                                            exit {command.exit_code ?? '—'} · {command.duration_ms ?? 0} ms
                                            {command.timed_out ? ' · timed out' : ''}
                                          </span>
                                        </summary>
                                        {command.error && <p>{command.error}</p>}
                                        {command.stdout && (
                                          <pre>
                                            {command.stdout}
                                            {command.stdout_truncated ? '\n… earlier output omitted' : ''}
                                          </pre>
                                        )}
                                        {command.stderr && (
                                          <pre>
                                            {command.stderr}
                                            {command.stderr_truncated ? '\n… earlier output omitted' : ''}
                                          </pre>
                                        )}
                                      </details>
                                    ))}
                                  </section>
                                );
                              })}
                            </details>
                          ))}
                        </div>
                      )}
                    </section>
                    <section className="reference-review">
                      <h3>Human review</h3>
                      <label>
                        Review note
                        <textarea
                          value={reviewNote}
                          maxLength={2000}
                          onChange={event => setReviewNote(event.target.value)}
                          placeholder="Explain requested changes or the approval decision."
                        />
                      </label>
                      <div className="task-form-actions">
                        <button
                          className="secondary-button"
                          disabled={referenceBusy || selectedReference.status !== 'pending_review'}
                          onClick={() => reviewReference('request_changes')}
                        >
                          Request changes
                        </button>
                        <button
                          className="secondary-button"
                          disabled={referenceBusy || selectedReference.status !== 'pending_review'}
                          onClick={() => reviewReference('reject')}
                        >
                          Reject
                        </button>
                        <button
                          className="primary-button"
                          disabled={
                            referenceBusy ||
                            selectedReference.status !== 'pending_review' ||
                            !workspaceApplied ||
                            selectedReference.validation.execution_mode !== 'automatic_container' ||
                            selectedReference.validation.build !== 'passed' ||
                            selectedReference.validation.tests !== 'passed'
                          }
                          onClick={() => reviewReference('approve')}
                        >
                          Approve reference
                        </button>
                      </div>
                      {selectedReference.reviewNote && (
                        <p className="form-hint">Latest review note: {selectedReference.reviewNote}</p>
                      )}
                    </section>
                  </>
                )
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
