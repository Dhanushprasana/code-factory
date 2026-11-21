export class UpdateAgentDto {
  name?: string;
  adapterType?: string;
  provider?: string;
  description?: string;
  status?: string;
  modelName?: string;
  settings?: Record<string, any>;
  credentialReference?: string | null;
}
