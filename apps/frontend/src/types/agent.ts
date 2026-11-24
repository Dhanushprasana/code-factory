export interface AgentConfig {
  id: string;
  agentId: string;
  configVersion: number;
  modelName: string;
  settings: Record<string, any>;
  credentialReference?: string | null;
  harborHarness?: string;
  apiKeyMasked?: string | null;
  hasApiKey?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Agent {
  id: string;
  name: string;
  adapterType: string;
  provider: string;
  description: string;
  status: string;
  modelName: string;
  settings: Record<string, any>;
  credentialReference?: string | null;
  harborHarness?: string;
  apiKeyMasked?: string | null;
  hasApiKey?: boolean;
  configs?: AgentConfig[];
  createdAt: string;
  updatedAt: string;
}
