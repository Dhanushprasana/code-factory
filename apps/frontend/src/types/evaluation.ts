export interface Evaluation {
  id: string;
  taskId: string;
  agentId: string;
  agentConfigId?: string | null;
  agentName: string;
  modelName: string;
  provider: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
  reward: number;
  score: number;
  durationMs: number;
  metrics?: Record<string, any>;
  trajectoryLogs?: string;
  testOutput?: string;
  errorMessage?: string | null;
  harborJobId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  modelName: string;
  provider: string;
  harborHarness: string;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
  averageReward: number;
  averageDurationMs: number;
  lastEvaluatedAt: string;
}
