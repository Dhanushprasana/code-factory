import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileCode2, FileDiff } from 'lucide-react';

export interface ReferenceModification {
  repository_id: string;
  file_path: string;
  operation: 'replace' | 'insert' | 'create' | 'delete' | string;
  description?: string;
  search?: string | null;
  replace?: string | null;
  position?: 'before' | 'after';
}

export interface ReferenceFileChange {
  repository_id: string;
  file_path: string;
  operation: 'replace' | 'insert' | 'create' | 'delete' | string;
  original_content: string;
  modified_content: string;
}

export interface PatchValidationError {
  index?: number;
  repository_id?: string;
  file_path?: string;
  operation?: string;
  description?: string;
  code?: string;
  message?: string;
  search?: string | null;
  replace?: string | null;
  actual_content?: string | null;
}

export interface ReferenceArtifactsData {
  id: string;
  status: string;
  errorMessage?: string | null;
  targetFiles?: string[] | null;
  modifications?: ReferenceModification[] | null;
  fileChanges?: ReferenceFileChange[] | null;
  solveScript?: string | null;
  validation?: Record<string, any> | null;
}

interface DiffLine {
  type: 'context' | 'add' | 'delete';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

function computeLineDiff(original: string, modified: string, operation: string): DiffLine[] {
  if (operation === 'create') {
    const lines = modified ? modified.replace(/\r\n/g, '\n').split('\n') : [];
    return lines.map((text, index) => ({
      type: 'add',
      oldLineNumber: null,
      newLineNumber: index + 1,
      text,
    }));
  }
  if (operation === 'delete') {
    const lines = original ? original.replace(/\r\n/g, '\n').split('\n') : [];
    return lines.map((text, index) => ({
      type: 'delete',
      oldLineNumber: index + 1,
      newLineNumber: null,
      text,
    }));
  }

  const oldLines = original ? original.replace(/\r\n/g, '\n').split('\n') : [];
  const newLines = modified ? modified.replace(/\r\n/g, '\n').split('\n') : [];
  const m = oldLines.length;
  const n = newLines.length;

  // Guard against huge DP matrices on very large files by trimming common prefix/suffix first.
  let prefix = 0;
  while (prefix < m && prefix < n && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < m - prefix
    && suffix < n - prefix
    && oldLines[m - 1 - suffix] === newLines[n - 1 - suffix]
  ) {
    suffix += 1;
  }

  const result: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    result.push({ type: 'context', oldLineNumber: i + 1, newLineNumber: i + 1, text: oldLines[i] });
  }

  const midOld = oldLines.slice(prefix, m - suffix);
  const midNew = newLines.slice(prefix, n - suffix);
  const om = midOld.length;
  const on = midNew.length;

  if (om * on <= 250_000) {
    const dp: number[][] = Array.from({ length: om + 1 }, () => new Array<number>(on + 1).fill(0));
    for (let i = om - 1; i >= 0; i -= 1) {
      for (let j = on - 1; j >= 0; j -= 1) {
        dp[i][j] = midOld[i] === midNew[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < om && j < on) {
      if (midOld[i] === midNew[j]) {
        result.push({
          type: 'context',
          oldLineNumber: prefix + i + 1,
          newLineNumber: prefix + j + 1,
          text: midOld[i],
        });
        i += 1;
        j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({
          type: 'delete',
          oldLineNumber: prefix + i + 1,
          newLineNumber: null,
          text: midOld[i],
        });
        i += 1;
      } else {
        result.push({
          type: 'add',
          oldLineNumber: null,
          newLineNumber: prefix + j + 1,
          text: midNew[j],
        });
        j += 1;
      }
    }
    while (i < om) {
      result.push({ type: 'delete', oldLineNumber: prefix + i + 1, newLineNumber: null, text: midOld[i] });
      i += 1;
    }
    while (j < on) {
      result.push({ type: 'add', oldLineNumber: null, newLineNumber: prefix + j + 1, text: midNew[j] });
      j += 1;
    }
  } else {
    for (let i = 0; i < om; i += 1) {
      result.push({ type: 'delete', oldLineNumber: prefix + i + 1, newLineNumber: null, text: midOld[i] });
    }
    for (let j = 0; j < on; j += 1) {
      result.push({ type: 'add', oldLineNumber: null, newLineNumber: prefix + j + 1, text: midNew[j] });
    }
  }

  for (let k = 0; k < suffix; k += 1) {
    const oldIdx = m - suffix + k;
    const newIdx = n - suffix + k;
    result.push({
      type: 'context',
      oldLineNumber: oldIdx + 1,
      newLineNumber: newIdx + 1,
      text: oldLines[oldIdx],
    });
  }

  return result;
}

function classifyShellToken(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) return 'shell-comment';
  if (/^(apply_replace|apply_insert|apply_create|apply_delete)\b/.test(trimmed)) return 'shell-fn';
  if (/^(set|local|if|then|fi|exit|rm|echo)\b/.test(trimmed)) return 'shell-kw';
  return 'shell-code';
}

export function ReferenceSolutionViewer({
  artifacts,
}: {
  artifacts: ReferenceArtifactsData | null;
}) {
  const [copied, setCopied] = useState(false);
  const [selectedFileKey, setSelectedFileKey] = useState<string>('');

  const fileChanges = useMemo(() => artifacts?.fileChanges ?? [], [artifacts?.fileChanges]);
  const modifications = useMemo(() => artifacts?.modifications ?? [], [artifacts?.modifications]);
  const solveScript = artifacts?.solveScript ?? null;

  useEffect(() => {
    setCopied(false);
    if (fileChanges.length > 0) {
      setSelectedFileKey(`${fileChanges[0].repository_id}:${fileChanges[0].file_path}`);
    } else {
      setSelectedFileKey('');
    }
  }, [artifacts?.id, fileChanges]);

  const activeChange = useMemo(() => {
    if (!fileChanges.length) return null;
    return fileChanges.find((item) => `${item.repository_id}:${item.file_path}` === selectedFileKey) ?? fileChanges[0];
  }, [fileChanges, selectedFileKey]);

  const activeModifications = useMemo(() => {
    if (!activeChange) return [];
    return modifications.filter(
      (mod) => mod.repository_id === activeChange.repository_id && mod.file_path === activeChange.file_path,
    );
  }, [activeChange, modifications]);

  const diffLines = useMemo(() => {
    if (!activeChange) return [];
    return computeLineDiff(
      activeChange.original_content,
      activeChange.modified_content,
      activeChange.operation,
    );
  }, [activeChange]);

  const handleCopy = async () => {
    if (!solveScript) return;
    try {
      await navigator.clipboard.writeText(solveScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!artifacts) {
    return null;
  }

  const scriptLines = solveScript ? solveScript.replace(/\r\n/g, '\n').split('\n') : [];

  return (
    <div className="reference-viewer-grid" data-testid="reference-solution-viewer">
      <section className="reference-viewer-panel" aria-label="Generated solve.sh">
        <header className="reference-viewer-head">
          <div className="reference-viewer-title">
            <FileCode2 size={15} />
            <h3>Generated <code>solve.sh</code></h3>
          </div>
          {solveScript && (
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={handleCopy}
              aria-label="Copy solve.sh"
            >
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
          )}
        </header>
        {solveScript ? (
          <div className="solve-script-viewer" role="region" aria-label="solve.sh source">
            {scriptLines.map((line, index) => (
              <div className="solve-script-line" key={index}>
                <span className="solve-line-number">{index + 1}</span>
                <code className={classifyShellToken(line)}>{line || ' '}</code>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            {artifacts.status === 'failed'
              ? 'solve.sh was not generated because patch validation failed.'
              : 'No solve.sh script has been compiled for this reference version.'}
          </div>
        )}
      </section>

      <section className="reference-viewer-panel" aria-label="Applied patch and file diffs">
        <header className="reference-viewer-head">
          <div className="reference-viewer-title">
            <FileDiff size={15} />
            <h3>Applied Patch / Resulting Diff</h3>
          </div>
          <span className="reference-viewer-count">
            {fileChanges.length} file{fileChanges.length === 1 ? '' : 's'}
          </span>
        </header>

        {fileChanges.length === 0 ? (
          artifacts.status === 'failed' && Array.isArray(artifacts.validation?.patch_errors) && artifacts.validation.patch_errors.length > 0 ? (
            <div className="patch-failure-inspector" data-testid="patch-failure-inspector">
              {(artifacts.validation.patch_errors as PatchValidationError[]).map((err, idx) => {
                const actualLines = typeof err.actual_content === 'string'
                  ? err.actual_content.replace(/\r\n/g, '\n').split('\n')
                  : [];
                return (
                  <article className="patch-failure-card" key={idx}>
                    <div className="patch-failure-head">
                      <span><strong>File:</strong> <code>{err.file_path || 'Unknown file'}</code></span>
                      {err.operation && <span className={`op-badge op-${err.operation}`}>{err.operation}</span>}
                      {err.code && <span className="status amber">{err.code}</span>}
                    </div>
                    {err.message && <p className="patch-failure-message">{err.message}</p>}
                    {err.description && <p className="patch-failure-desc"><strong>Description:</strong> {err.description}</p>}
                    <div className="patch-failure-blocks">
                      <div className="patch-failure-block">
                        <h4>What was searched</h4>
                        <pre className="patch-code-block patch-code-search">{err.search ?? '(none)'}</pre>
                      </div>
                      <div className="patch-failure-block">
                        <h4>Intended replacement</h4>
                        <pre className="patch-code-block patch-code-replace">{err.replace ?? '(none)'}</pre>
                      </div>
                    </div>
                    <div className="patch-failure-block">
                      <h4>Actual file content ({actualLines.length} lines)</h4>
                      {typeof err.actual_content === 'string' ? (
                        <div className="actual-file-viewer" role="region" aria-label={`Actual content of ${err.file_path || 'file'}`}>
                          {actualLines.map((line, lineIdx) => (
                            <div className="actual-file-line" key={lineIdx}>
                              <span className="diff-ln">{lineIdx + 1}</span>
                              <code>{line || ' '}</code>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="patch-failure-desc">Actual file content unavailable.</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state compact">
              {artifacts.status === 'failed'
                ? (artifacts.errorMessage || 'Patch validation failed; no file diffs were applied.')
                : 'No file diffs available for this reference version.'}
            </div>
          )
        ) : (
          <div className="diff-panel-body">
            <div className="diff-file-tabs" role="tablist" aria-label="Modified files">
              {fileChanges.map((change) => {
                const key = `${change.repository_id}:${change.file_path}`;
                const isSelected = activeChange && `${activeChange.repository_id}:${activeChange.file_path}` === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={Boolean(isSelected)}
                    className={`diff-file-tab ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedFileKey(key)}
                  >
                    <code>{change.file_path}</code>
                    <span className={`op-badge op-${change.operation}`}>{change.operation}</span>
                  </button>
                );
              })}
            </div>

            {activeChange && (
              <div className="diff-file-detail">
                <div className="diff-file-meta">
                  <span><strong>File:</strong> <code>{activeChange.file_path}</code></span>
                  <span><strong>Operation:</strong> <span className={`op-badge op-${activeChange.operation}`}>{activeChange.operation}</span></span>
                </div>
                {activeModifications.length > 0 && (
                  <ul className="diff-modification-notes">
                    {activeModifications.map((mod, idx) => (
                      <li key={idx}>
                        <span className={`op-badge op-${mod.operation}`}>{mod.operation}</span>
                        <span>{mod.description || 'Source modification'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="diff-lines-table" role="region" aria-label={`Diff for ${activeChange.file_path}`}>
                  {diffLines.map((line, idx) => (
                    <div className={`diff-line diff-line-${line.type}`} key={idx}>
                      <span className="diff-ln">{line.oldLineNumber ?? ''}</span>
                      <span className="diff-ln">{line.newLineNumber ?? ''}</span>
                      <span className="diff-marker">
                        {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                      </span>
                      <code>{line.text || ' '}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
