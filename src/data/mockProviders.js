export const mockProviders = [
  {
    id: "prov-openrouter",
    name: "OpenRouter",
    category: "Aggregator / Multi-Model",
    description: "Multi-provider LLM gateway supporting unified API keys across Claude, GPT-4, Llama, and Gemini models.",
    apiKey: "sk-or-v1-••••••••••••••••••••••••3821",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "anthropic/claude-3.7-sonnet",
      "google/gemini-2.0-flash-001",
      "openai/gpt-4o-2024-11-20",
      "deepseek/deepseek-r1"
    ],
    baseUrl: "https://openrouter.ai/api/v1",
    status: "active",
    isDefault: false,
    byokNote: "Development testing can leverage available rate-limited test models. Usage charges depend on your provider account.",
    lastTested: "2026-11-19T10:00:00Z"
  },
  {
    id: "prov-gemini",
    name: "Google Gemini",
    category: "Direct Provider",
    description: "High-context multimodal and code-optimized model family for deep repository architecture comprehension.",
    apiKey: "AIzaSy••••••••••••••••••••••••••••8012",
    model: "gemini-2.5-pro",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash-thinking-exp",
      "gemini-2.0-flash"
    ],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    status: "active",
    isDefault: true,
    byokNote: "Bring Your Own Key (BYOK). All prompt generation tokens billed directly to your Google Cloud billing project.",
    lastTested: "2026-11-19T12:00:00Z"
  },
  {
    id: "prov-openai",
    name: "OpenAI",
    category: "Direct Provider",
    description: "Standard GPT-4o and reasoning models for task specification and test generation.",
    apiKey: "sk-proj-••••••••••••••••••••••••4990",
    model: "gpt-4o",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "o1",
      "o3-mini"
    ],
    baseUrl: "https://api.openai.com/v1",
    status: "active",
    isDefault: false,
    byokNote: "Bring Your Own Key (BYOK). OpenAI platform usage billed directly through your organization account.",
    lastTested: "2026-11-18T16:00:00Z"
  },
  {
    id: "prov-anthropic",
    name: "Anthropic",
    category: "Direct Provider",
    description: "Claude 3.7 family with extended thinking for thorough acceptance criteria and edge case generation.",
    apiKey: "sk-ant-••••••••••••••••••••••••7721",
    model: "claude-3-7-sonnet-20250219",
    models: [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022"
    ],
    baseUrl: "https://api.anthropic.com/v1",
    status: "active",
    isDefault: false,
    byokNote: "Bring Your Own Key (BYOK). Anthropic usage handled by your Anthropic console workspace.",
    lastTested: "2026-11-18T11:00:00Z"
  },
  {
    id: "prov-custom",
    name: "Custom OpenAI-Compatible Provider",
    category: "Self-Hosted / Gateway",
    description: "Local or private enterprise inference endpoints (vLLM, Ollama, LiteLLM, TensorRT-LLM).",
    apiKey: "custom-token-••••••••••••",
    model: "deepseek-coder-v2-lite",
    models: [
      "deepseek-coder-v2-lite",
      "qwen2.5-coder-32b-instruct",
      "starcoder2-15b"
    ],
    baseUrl: "http://internal-vllm.infra.corp:8000/v1",
    status: "inactive",
    isDefault: false,
    byokNote: "Direct connection to your private API cluster behind enterprise firewalls or VPNs.",
    lastTested: null
  }
];
