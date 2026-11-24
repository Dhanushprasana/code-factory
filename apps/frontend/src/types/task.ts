export type TaskContextComponent = {
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

export type TaskProvider = 'openrouter' | 'ollama';

export type TaskCandidate = {
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

export type TaskGeneration = {
  id: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  candidates?: TaskCandidate[];
  errorMessage?: string | null;
  createdAt: string;
};

export type SavedTask = {
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

export type ReferenceSolution = {
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

export const taskCategories = [
  ['feature', 'Feature implementation'],
  ['bug_fix', 'Bug fixing'],
  ['api_enhancement', 'API enhancement'],
  ['refactoring', 'Refactoring'],
  ['database_change', 'Database change'],
  ['performance', 'Performance improvement'],
  ['test_improvement', 'Test improvement'],
] as const;
