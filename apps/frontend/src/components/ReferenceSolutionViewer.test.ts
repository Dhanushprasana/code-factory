import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ReferenceSolutionViewer, type ReferenceArtifactsData } from './ReferenceSolutionViewer';

const assert = {
  ok(condition: unknown, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
  },
};

// 1. Both panels display the same reference-solution generation, left panel shows solve.sh, right panel shows decoded diffs
{
  const artifacts: ReferenceArtifactsData = {
    id: 'ref-1',
    status: 'pending_review',
    solveScript: "#!/usr/bin/env bash\nset -euo pipefail\napply_replace 'src/a.ts' 'YWJj' 'ZGVm'\n",
    modifications: [
      {
        repository_id: 'repo-1',
        file_path: 'src/a.ts',
        operation: 'replace',
        description: 'Update single-quoted export',
      },
      {
        repository_id: 'repo-1',
        file_path: 'src/new.ts',
        operation: 'create',
        description: 'Create helper file',
      },
      {
        repository_id: 'repo-1',
        file_path: 'src/old.ts',
        operation: 'delete',
        description: 'Delete legacy file',
      },
    ],
    fileChanges: [
      {
        repository_id: 'repo-1',
        file_path: 'src/a.ts',
        operation: 'replace',
        original_content: "export const a = 'old';\n",
        modified_content: "export const a = 'new';\n",
      },
      {
        repository_id: 'repo-1',
        file_path: 'src/new.ts',
        operation: 'create',
        original_content: '',
        modified_content: 'export const created = true;\n',
      },
      {
        repository_id: 'repo-1',
        file_path: 'src/old.ts',
        operation: 'delete',
        original_content: 'export const legacy = true;\n',
        modified_content: '',
      },
    ],
  };

  const html = renderToStaticMarkup(createElement(ReferenceSolutionViewer, { artifacts }));
  assert.ok(html.includes('reference-viewer-grid'), 'Two-panel grid container should render');
  assert.ok(html.includes('#!/usr/bin/env bash'), 'Left panel should display actual solve.sh');
  assert.ok(html.includes("apply_replace &#x27;src/a.ts&#x27;"), 'Left panel should display solve.sh commands');
  assert.ok(html.includes('3 files'), 'Right panel should list all modified files');
  assert.ok(html.includes('src/a.ts'), 'Right panel should show src/a.ts tab');
  assert.ok(html.includes('src/new.ts'), 'Right panel should show created file tab');
  assert.ok(html.includes('src/old.ts'), 'Right panel should show deleted file tab');
  assert.ok(html.includes('export const a = &#x27;old&#x27;;'), 'Diff should show original line');
  assert.ok(html.includes('export const a = &#x27;new&#x27;;'), 'Diff should show modified line');
}

// 2. Created file renders additions and deleted file renders deletions when selected first
{
  const createdArtifacts: ReferenceArtifactsData = {
    id: 'ref-create',
    status: 'pending_review',
    solveScript: '#!/usr/bin/env bash\n',
    fileChanges: [{
      repository_id: 'repo-1',
      file_path: 'src/created.ts',
      operation: 'create',
      original_content: '',
      modified_content: 'export const ok = 1;\n',
    }],
  };
  const createdHtml = renderToStaticMarkup(createElement(ReferenceSolutionViewer, { artifacts: createdArtifacts }));
  assert.ok(createdHtml.includes('diff-line-add'), 'Created file should render additions');
  assert.ok(createdHtml.includes('export const ok = 1;'));

  const deletedArtifacts: ReferenceArtifactsData = {
    id: 'ref-delete',
    status: 'pending_review',
    solveScript: '#!/usr/bin/env bash\n',
    fileChanges: [{
      repository_id: 'repo-1',
      file_path: 'src/deleted.ts',
      operation: 'delete',
      original_content: 'export const gone = 1;\n',
      modified_content: '',
    }],
  };
  const deletedHtml = renderToStaticMarkup(createElement(ReferenceSolutionViewer, { artifacts: deletedArtifacts }));
  assert.ok(deletedHtml.includes('diff-line-delete'), 'Deleted file should render deletions');
  assert.ok(deletedHtml.includes('export const gone = 1;'));
}

// 3. Missing or failed patch data handled gracefully
{
  const failedArtifacts: ReferenceArtifactsData = {
    id: 'ref-failed',
    status: 'failed',
    errorMessage: 'Exact search block not found in src/a.ts.',
    solveScript: null,
    fileChanges: [],
  };
  const failedHtml = renderToStaticMarkup(createElement(ReferenceSolutionViewer, { artifacts: failedArtifacts }));
  assert.ok(failedHtml.includes('solve.sh was not generated because patch validation failed.'));
  assert.ok(failedHtml.includes('Exact search block not found in src/a.ts.'));

  const detailedFailedArtifacts: ReferenceArtifactsData = {
    id: 'ref-failed-detail',
    status: 'failed',
    errorMessage: "Exact search block not found in 'src/a.ts'.",
    solveScript: null,
    fileChanges: [],
    validation: {
      patch_errors: [{
        file_path: 'src/a.ts',
        operation: 'replace',
        description: 'Update constant',
        code: 'search_not_found',
        message: "Exact search block not found in 'src/a.ts'.",
        search: 'const x = "old";',
        replace: 'const x = "new";',
        actual_content: "const x = 'old';\n",
      }],
    },
  };
  const detailedHtml = renderToStaticMarkup(createElement(ReferenceSolutionViewer, { artifacts: detailedFailedArtifacts }));
  assert.ok(detailedHtml.includes('What was searched'));
  assert.ok(detailedHtml.includes('Intended replacement'));
  assert.ok(detailedHtml.includes('Actual file content (2 lines)'));
  assert.ok(detailedHtml.includes('const x = &quot;old&quot;;'));
  assert.ok(detailedHtml.includes('const x = &#x27;old&#x27;;'));
}

console.log('All ReferenceSolutionViewer frontend tests passed.');
