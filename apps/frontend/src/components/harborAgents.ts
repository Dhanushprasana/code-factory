export interface HarborAgentDefinition {
  harborName: string;
  label: string;
  defaultProvider: string;
  defaultModel: string;
  defaultApiKeyEnv: string;
}

/**
 * Official agents from harbor-framework/harbor (src/harbor/agents/installed + terminus-2 / acp).
 */
export const HARBOR_INSTALLED_AGENTS: HarborAgentDefinition[] = [
  { harborName: 'claude-code', label: 'Claude Code', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  { harborName: 'codex', label: 'Codex', defaultProvider: 'OpenAI', defaultModel: 'openai/gpt-5', defaultApiKeyEnv: 'OPENAI_API_KEY' },
  { harborName: 'gemini-cli', label: 'Gemini CLI', defaultProvider: 'Google', defaultModel: 'google/gemini-2.5-pro', defaultApiKeyEnv: 'GEMINI_API_KEY' },
  { harborName: 'antigravity-cli', label: 'Antigravity CLI', defaultProvider: 'Google DeepMind', defaultModel: 'google/gemini-2.5-pro', defaultApiKeyEnv: 'GEMINI_API_KEY' },
  { harborName: 'antigravity-sdk', label: 'Antigravity SDK', defaultProvider: 'Google DeepMind', defaultModel: 'google/gemini-2.5-pro', defaultApiKeyEnv: 'GEMINI_API_KEY' },
  { harborName: 'aider', label: 'Aider', defaultProvider: 'OpenRouter', defaultModel: 'openrouter/openai/gpt-4o', defaultApiKeyEnv: 'OPENROUTER_API_KEY' },
  { harborName: 'cline-cli', label: 'Cline CLI', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  { harborName: 'copilot-cli', label: 'Copilot CLI', defaultProvider: 'GitHub', defaultModel: 'github/gpt-4o', defaultApiKeyEnv: 'GITHUB_TOKEN' },
  { harborName: 'cursor-cli', label: 'Cursor CLI', defaultProvider: 'Cursor', defaultModel: 'cursor/default', defaultApiKeyEnv: 'CURSOR_API_KEY' },
  { harborName: 'goose', label: 'Goose', defaultProvider: 'OpenAI', defaultModel: 'openai/gpt-4o', defaultApiKeyEnv: 'OPENAI_API_KEY' },
  { harborName: 'grok-build', label: 'Grok Build', defaultProvider: 'xAI', defaultModel: 'xai/grok-3', defaultApiKeyEnv: 'XAI_API_KEY' },
  { harborName: 'openhands', label: 'OpenHands', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'LLM_API_KEY' },
  { harborName: 'openhands-sdk', label: 'OpenHands SDK', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'LLM_API_KEY' },
  { harborName: 'opencode', label: 'OpenCode', defaultProvider: 'OpenRouter', defaultModel: 'openrouter/openai/gpt-4o', defaultApiKeyEnv: 'OPENROUTER_API_KEY' },
  { harborName: 'opencode-v2', label: 'OpenCode v2', defaultProvider: 'OpenRouter', defaultModel: 'openrouter/openai/gpt-4o', defaultApiKeyEnv: 'OPENROUTER_API_KEY' },
  { harborName: 'swe-agent', label: 'SWE-agent', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  { harborName: 'mini-swe-agent', label: 'Mini SWE-agent', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  { harborName: 'terminus-2', label: 'Terminus 2', defaultProvider: 'OpenRouter', defaultModel: 'openrouter/openai/gpt-4o', defaultApiKeyEnv: 'OPENROUTER_API_KEY' },
  { harborName: 'acp', label: 'ACP Agent', defaultProvider: 'Custom', defaultModel: 'default', defaultApiKeyEnv: 'AGENT_API_KEY' },
  { harborName: 'code-puppy', label: 'Code Puppy', defaultProvider: 'OpenAI', defaultModel: 'openai/gpt-4o', defaultApiKeyEnv: 'OPENAI_API_KEY' },
  { harborName: 'cortex-code', label: 'Cortex Code', defaultProvider: 'Snowflake', defaultModel: 'cortex/claude-3-7-sonnet', defaultApiKeyEnv: 'SNOWFLAKE_API_KEY' },
  { harborName: 'deerflow', label: 'DeerFlow', defaultProvider: 'OpenAI', defaultModel: 'openai/gpt-4o', defaultApiKeyEnv: 'OPENAI_API_KEY' },
  { harborName: 'devin', label: 'Devin', defaultProvider: 'Cognition', defaultModel: 'devin/default', defaultApiKeyEnv: 'DEVIN_API_KEY' },
  { harborName: 'eve', label: 'Eve', defaultProvider: 'Custom', defaultModel: 'default', defaultApiKeyEnv: 'EVE_API_KEY' },
  { harborName: 'fabric', label: 'Fabric', defaultProvider: 'OpenAI', defaultModel: 'openai/gpt-4o', defaultApiKeyEnv: 'OPENAI_API_KEY' },
  { harborName: 'fx', label: 'Fx', defaultProvider: 'Custom', defaultModel: 'default', defaultApiKeyEnv: 'FX_API_KEY' },
  { harborName: 'fx-dev', label: 'Fx Dev', defaultProvider: 'Custom', defaultModel: 'default', defaultApiKeyEnv: 'FX_API_KEY' },
  { harborName: 'hermes', label: 'Hermes', defaultProvider: 'OpenRouter', defaultModel: 'openrouter/nousresearch/hermes-3', defaultApiKeyEnv: 'OPENROUTER_API_KEY' },
  { harborName: 'junie', label: 'Junie', defaultProvider: 'JetBrains', defaultModel: 'junie/default', defaultApiKeyEnv: 'JUNIE_API_KEY' },
  { harborName: 'kimi-cli', label: 'Kimi CLI', defaultProvider: 'Moonshot', defaultModel: 'moonshot/kimi-k2', defaultApiKeyEnv: 'MOONSHOT_API_KEY' },
  { harborName: 'kimi-code', label: 'Kimi Code', defaultProvider: 'Moonshot', defaultModel: 'moonshot/kimi-k2', defaultApiKeyEnv: 'MOONSHOT_API_KEY' },
  { harborName: 'langgraph', label: 'LangGraph', defaultProvider: 'OpenAI', defaultModel: 'openai/gpt-4o', defaultApiKeyEnv: 'OPENAI_API_KEY' },
  { harborName: 'mcode', label: 'MCode', defaultProvider: 'Custom', defaultModel: 'default', defaultApiKeyEnv: 'MCODE_API_KEY' },
  { harborName: 'mimo', label: 'MiMo', defaultProvider: 'Xiaomi', defaultModel: 'mimo/default', defaultApiKeyEnv: 'MIMO_API_KEY' },
  { harborName: 'muse-code', label: 'Muse Code', defaultProvider: 'Custom', defaultModel: 'default', defaultApiKeyEnv: 'MUSE_API_KEY' },
  { harborName: 'nemo-agent', label: 'NeMo Agent', defaultProvider: 'NVIDIA', defaultModel: 'nvidia/nemotron', defaultApiKeyEnv: 'NVIDIA_API_KEY' },
  { harborName: 'openclaw', label: 'OpenClaw', defaultProvider: 'OpenRouter', defaultModel: 'openrouter/openai/gpt-4o', defaultApiKeyEnv: 'OPENROUTER_API_KEY' },
  { harborName: 'pi', label: 'Pi', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  { harborName: 'qwen-coder', label: 'Qwen Coder', defaultProvider: 'Alibaba', defaultModel: 'qwen/qwen3-coder', defaultApiKeyEnv: 'DASHSCOPE_API_KEY' },
  { harborName: 'rovodev-cli', label: 'RovoDev CLI', defaultProvider: 'Atlassian', defaultModel: 'rovodev/default', defaultApiKeyEnv: 'ROVODEV_API_KEY' },
  { harborName: 'strands', label: 'Strands', defaultProvider: 'AWS', defaultModel: 'bedrock/claude-sonnet', defaultApiKeyEnv: 'AWS_ACCESS_KEY_ID' },
  { harborName: 'trae-agent', label: 'Trae Agent', defaultProvider: 'Anthropic', defaultModel: 'anthropic/claude-sonnet-4-5', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  { harborName: 'vibe', label: 'Vibe', defaultProvider: 'Mistral', defaultModel: 'mistral/devstral', defaultApiKeyEnv: 'MISTRAL_API_KEY' },
];
