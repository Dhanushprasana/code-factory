import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, History, Sparkles } from 'lucide-react';
import { apiUrl, request } from '../api/client';
import { PageHeader } from '../components/common/PageHeader';
import {
  type ProjectOption,
  type SavedTask,
  type TaskCandidate,
  type TaskContextComponent,
  type TaskGeneration,
  type TaskProvider,
  taskCategories,
} from '../types';

export function TaskGeneratorPage() {
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
        setProjectId(current => (items.some(item => item.id === current) ? current : (items[0]?.id ?? '')));
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
    ])
      .then(([context, runs]) => {
        if (!active) return;
        setComponents(context.components);
        setSelectedAnalysisIds(
          context.components.filter(item => item.ready && item.analysisId).map(item => item.analysisId!),
        );
        setHistory(runs);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load project task context.');
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const selectedCandidate = generation?.candidates?.[candidateIndex];

  const selectCandidate = (index: number) => {
    setCandidateIndex(index);
    setDraft(generation?.candidates?.[index] ?? null);
  };

  const toggleAnalysis = (analysisId: string) => {
    setSelectedAnalysisIds(current =>
      current.includes(analysisId) ? current.filter(id => id !== analysisId) : [...current, analysisId],
    );
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
          constraints: constraints
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean),
          count,
        }),
      });
      setGeneration(result);
      setCandidateIndex(0);
      setDraft(result.candidates?.[0] ?? null);
      setHistory(current => [result, ...current.filter(run => run.id !== result.id)]);
      setNotice(
        `Generated ${result.candidates?.length ?? 0} repository-grounded draft(s) with ${result.provider} · ${result.model}.`,
      );
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
    setDraft(current => (current ? { ...current, [field]: value } : current));
  };

  return (
    <div className="page task-workspace">
      <PageHeader
        eyebrow="Task creation"
        title="Task generator"
        action={
          <button className="secondary-button" onClick={() => navigate('/tasks')}>
            <ClipboardList size={15} /> Task library
          </button>
        }
      />
      <p className="task-page-intro">
        Create task drafts from completed analyses of this project's pinned repository snapshots. Every suggestion keeps
        file and commit provenance for review.
      </p>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}
      <div className="task-layout">
        <section className="panel task-form">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Step 1 · project scope</span>
              <h2>Task configuration</h2>
            </div>
            <Sparkles size={18} />
          </div>
          <label>
            Project workspace
            <select
              value={projectId}
              onChange={event => {
                setProjectId(event.target.value);
                setGeneration(null);
                setDraft(null);
              }}
            >
              <option value="">Choose a project…</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <p className="form-hint">
            Only the selected project's connected repositories and their current pinned commits can be used as task
            context.
          </p>
          <div className="task-context-picker">
            <div className="task-subhead">
              <strong>Analyzed project components</strong>
              <span>{selectedAnalysisIds.length} selected</span>
            </div>
            {components.length ? (
              components.map(component => (
                <label className="task-context-option" key={component.repositoryId}>
                  <input
                    type="checkbox"
                    checked={Boolean(component.analysisId && selectedAnalysisIds.includes(component.analysisId))}
                    disabled={!component.ready || !component.analysisId}
                    onChange={() => component.analysisId && toggleAnalysis(component.analysisId)}
                  />
                  <span>
                    <b>{component.repositoryName}</b>
                    <small>
                      {component.role} · {component.branch || 'branch unavailable'} ·{' '}
                      {component.commitSha?.slice(0, 12) ?? 'No pinned commit'}
                    </small>
                    <small>
                      {component.ready
                        ? `${component.modules.length} modules · analyzed ${component.analyzedAt ? new Date(component.analyzedAt).toLocaleDateString() : ''}`
                        : 'Clone the selected snapshot and complete its repository analysis first.'}
                    </small>
                  </span>
                  <span className={`status ${component.ready ? 'green' : 'amber'}`}>
                    {component.ready ? 'Ready' : 'Needs analysis'}
                  </span>
                </label>
              ))
            ) : (
              <div className="empty-state compact">Connect, clone, and analyze a repository before creating a task.</div>
            )}
          </div>
          <label>
            Task idea (optional)
            <textarea
              value={idea}
              onChange={event => setIdea(event.target.value)}
              maxLength={1000}
              placeholder="e.g. Make order cancellation idempotent and preserve inventory invariants"
            />
          </label>
          <div className="field-grid">
            <label>
              Category
              <select value={category} onChange={event => setCategory(event.target.value)}>
                {taskCategories.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Difficulty
              <select value={difficulty} onChange={event => setDifficulty(event.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </div>
          <label>
            Additional constraints (one per line)
            <textarea
              value={constraints}
              onChange={event => setConstraints(event.target.value)}
              placeholder={'Keep current API behavior backward compatible\nInclude invalid-input and boundary cases'}
            />
          </label>
          <label>
            Suggestions to generate
            <select value={count} onChange={event => setCount(Number(event.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>
          <label>
            AI provider
            <select
              value={provider}
              onChange={event => {
                const value = event.target.value;
                setProvider(value === 'openrouter' || value === 'ollama' ? value : '');
              }}
            >
              <option value="">Choose a provider…</option>
              <option value="openrouter">OpenRouter (hosted models)</option>
              <option value="ollama">Ollama (local model)</option>
            </select>
          </label>
          <p className="form-hint">
            OpenRouter needs an API key in the backend environment. Ollama needs a running local server and a pulled
            model. Source context goes only to the provider you select.
          </p>
          <div className="task-form-actions">
            <button
              className="primary-button"
              onClick={generate}
              disabled={busy || !selectedAnalysisIds.length || !provider}
            >
              <Sparkles size={16} />
              {busy ? 'Generating from repository context…' : 'Generate task drafts'}
            </button>
          </div>
          <p className="form-hint">Repository code is treated as untrusted input; ForgeBench does not execute it.</p>
        </section>
        <section className="panel task-guardrails">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Review before saving</span>
              <h2>Generation guardrails</h2>
            </div>
            <span className="status green">Enabled</span>
          </div>
          <ul className="task-guardrail-list">
            <li>
              <b>Commit pinned</b>
              <span>Each draft records the selected repository snapshot and full commit SHA.</span>
            </li>
            <li>
              <b>Source grounded</b>
              <span>Context uses keyword, structure, and static graph retrieval from completed analysis reports.</span>
            </li>
            <li>
              <b>Measurable criteria</b>
              <span>Review requirements and acceptance criteria for observable behavior and edge cases.</span>
            </li>
            <li>
              <b>Human editable</b>
              <span>Generated wording is a draft. Edit it and save only after review.</span>
            </li>
            <li>
              <b>No hidden claims</b>
              <span>Source references and affected modules are validated against the retrieved snapshot context.</span>
            </li>
          </ul>
          <div className="demo-notice">
            Choose OpenRouter for hosted models or Ollama to keep repository context on your local model endpoint. Provider
            credentials and model names are configured separately in the backend environment.
          </div>
          <div className="task-history">
            <div className="task-subhead">
              <strong>
                <History size={15} /> Generation history
              </strong>
              <span>{history.length} runs</span>
            </div>
            {history.length ? (
              <select
                aria-label="Load previous task generation"
                defaultValue=""
                onChange={event => event.target.value && loadGeneration(event.target.value)}
              >
                <option value="">Choose a previous generation…</option>
                {history.map(run => (
                  <option key={run.id} value={run.id}>
                    {new Date(run.createdAt).toLocaleString()} · {run.provider || 'provider unknown'} · {run.status} ·{' '}
                    {run.candidates?.length ?? 0} suggestions
                  </option>
                ))}
              </select>
            ) : (
              <p className="form-hint">Generation runs are recorded here for this project.</p>
            )}
          </div>
        </section>
      </div>
      <section className="panel task-preview">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Step 2 · review and edit</span>
            <h2>Generated task preview</h2>
          </div>
          <span className={`status ${generation?.status === 'completed' ? 'green' : 'gray'}`}>
            {generation?.status ?? 'Waiting for generation'}
          </span>
        </div>
        {!generation?.candidates?.length || !draft ? (
          <div className="empty-state">
            Configure a project with an analyzed snapshot, then generate task drafts to review them here.
          </div>
        ) : (
          <>
            <div className="task-candidate-tabs" role="tablist" aria-label="Task suggestions">
              {generation.candidates.map((candidate, index) => (
                <button
                  type="button"
                  className={index === candidateIndex ? 'selected' : ''}
                  key={`${candidate.title}-${index}`}
                  onClick={() => selectCandidate(index)}
                >
                  Draft {index + 1}
                  <small>{candidate.title}</small>
                </button>
              ))}
            </div>
            {selectedCandidate && (
              <div className="task-review-grid">
                <div className="task-review-fields">
                  <label>
                    Title
                    <input value={draft.title} maxLength={160} onChange={event => changeDraft('title', event.target.value)} />
                  </label>
                  <label>
                    Description
                    <textarea
                      value={draft.description}
                      maxLength={3000}
                      rows={4}
                      onChange={event => changeDraft('description', event.target.value)}
                    />
                  </label>
                  <div className="field-grid">
                    <label>
                      Category
                      <select value={draft.category} onChange={event => changeDraft('category', event.target.value)}>
                        {taskCategories.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Difficulty
                      <select value={draft.difficulty} onChange={event => changeDraft('difficulty', event.target.value)}>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Requirements (one per line)
                    <textarea
                      rows={5}
                      value={draft.requirements.join('\n')}
                      onChange={event => changeDraft('requirements', event.target.value.split(/\r?\n/))}
                    />
                  </label>
                  <label>
                    Acceptance criteria (one per line)
                    <textarea
                      rows={5}
                      value={draft.acceptance_criteria.join('\n')}
                      onChange={event => changeDraft('acceptance_criteria', event.target.value.split(/\r?\n/))}
                    />
                  </label>
                  <label>
                    Constraints (one per line)
                    <textarea
                      rows={3}
                      value={draft.constraints.join('\n')}
                      onChange={event => changeDraft('constraints', event.target.value.split(/\r?\n/))}
                    />
                  </label>
                  {draft.harbor_files && (
                    <div className="task-detail-section" style={{ marginTop: 16 }}>
                      <h3>Harbor Task Package Artifacts</h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        <details className="reference-artifact">
                          <summary>instruction.md</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                            {draft.harbor_files.instruction_md}
                          </pre>
                        </details>
                        <details className="reference-artifact">
                          <summary>task.toml (Harbor v1.4)</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                            {draft.harbor_files.task_toml}
                          </pre>
                        </details>
                        <details className="reference-artifact">
                          <summary>environment/Dockerfile</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                            {draft.harbor_files.dockerfile}
                          </pre>
                        </details>
                        <details className="reference-artifact">
                          <summary>solution/solve.sh</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                            {draft.harbor_files.solve_sh}
                          </pre>
                        </details>
                        <details className="reference-artifact">
                          <summary>tests/test.sh (reward verifier)</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', fontSize: 12, padding: 8, background: '#f8fafc' }}>
                            {draft.harbor_files.test_sh}
                          </pre>
                        </details>
                      </div>
                    </div>
                  )}
                </div>
                <aside className="task-evidence-panel">
                  <h3>Repository evidence</h3>
                  <div className="task-module-tags">
                    {draft.affected_modules.map(module => (
                      <span className="analysis-tag" key={module}>
                        {module}
                      </span>
                    ))}
                  </div>
                  {draft.evidence.map((evidence, index) => (
                    <div
                      className="task-evidence-item"
                      key={`${evidence.snapshot_id}-${evidence.file_path}-${index}`}
                    >
                      <b>{evidence.symbol || 'Source evidence'}</b>
                      <code>
                        {evidence.file_path}:{evidence.start_line}-{evidence.end_line}
                      </code>
                      <small>Commit {evidence.commit_sha.slice(0, 12)}</small>
                    </div>
                  ))}
                  <div className="task-form-actions">
                    <button className="primary-button" onClick={saveDraft} disabled={saving}>
                      {saving ? 'Saving draft…' : 'Save reviewed draft'}
                    </button>
                  </div>
                  <p className="form-hint">
                    Saving creates task version 1. Later edits create immutable versions and retain the original
                    commit/context manifest.
                  </p>
                </aside>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
