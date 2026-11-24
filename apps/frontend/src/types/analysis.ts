export type AnalysisRecord = {
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
  contextMarkdown?: string | null;
  contextStatus?: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | null;
  contextError?: string | null;
};

export type FileTreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children: FileTreeNode[];
};

export type FeatureArea = {
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

export type ModuleConnection = {
  source: string;
  target: string;
  calls: number;
};
