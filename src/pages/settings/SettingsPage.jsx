import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  Sliders,
  Sparkles,
  Bot,
  Server,
  Cpu,
  HardDrive,
  Shield,
  CheckCircle2,
  AlertCircle,
  Key,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Info,
  ExternalLink
} from 'lucide-react';

export const SettingsPage = () => {
  const {
    providers,
    updateProvider,
    environments,
    createEnvironment,
    deleteEnvironment,
    agents,
    addToast
  } = useApp();

  const [activeTab, setActiveTab] = useState('general');

  // General Settings state
  const [generalForm, setGeneralForm] = useState({
    workspaceName: 'Engineering Benchmarking Core',
    defaultProject: 'E-Commerce Core & Checkout',
    timeZone: 'UTC+05:30 (IST)',
    notificationEmail: 'gary.chen@taskforge.dev',
    notifyOnRunComplete: true,
    notifyOnValidationFail: true,
    theme: 'Dark First (High Contrast)',
  });

  // Benchmark Defaults state
  const [benchmarkDefaults, setBenchmarkDefaults] = useState({
    defaultComplexity: 'Medium',
    defaultTimeoutMinutes: 25,
    defaultCpu: '4 vCPUs',
    defaultMemory: '8 GB RAM',
    autoValidateOnCreate: true,
    generateHiddenTestsCount: 20,
    scoringWeightFunctional: 60,
    scoringWeightRegression: 25,
    scoringWeightQuality: 10,
    scoringWeightReliability: 5,
  });

  // State for testing provider connection simulation
  const [testingProviderId, setTestingProviderId] = useState(null);

  const handleTestProvider = (providerId) => {
    setTestingProviderId(providerId);
    setTimeout(() => {
      setTestingProviderId(null);
      addToast({
        title: 'Connection Successful',
        message: 'LLM provider endpoint verified and model ping responded in 142ms.',
        type: 'success'
      });
    }, 800);
  };

  const navTabs = [
    { key: 'general', label: 'General', icon: Sliders },
    { key: 'providers', label: 'AI LLM Providers', icon: Sparkles },
    { key: 'agents', label: 'Coding Agent Integrations', icon: Bot },
    { key: 'environments', label: 'Execution Environments', icon: Server },
    { key: 'defaults', label: 'Benchmark Defaults', icon: Cpu },
    { key: 'storage', label: 'Storage & Usage', icon: HardDrive },
    { key: 'security', label: 'Security & Access', icon: Shield },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & Workspace Configuration"
        description="Manage workspace parameters, Bring-Your-Own-Key LLM providers, agent runtimes, and execution environments."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Secondary Navigation Sidebar */}
        <div className="space-y-1">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all text-left ${
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Pane */}
        <div className="md:col-span-3">
          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-5">
              <div className="pb-3 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">General Workspace Settings</h3>
                <p className="text-xs text-slate-400">Configure global workspace defaults, notifications, and localization</p>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Workspace Name
                  </label>
                  <input
                    type="text"
                    value={generalForm.workspaceName}
                    onChange={(e) => setGeneralForm({ ...generalForm, workspaceName: e.target.value })}
                    className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                      Time Zone
                    </label>
                    <input
                      type="text"
                      value={generalForm.timeZone}
                      onChange={(e) => setGeneralForm({ ...generalForm, timeZone: e.target.value })}
                      className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                      Notification Email
                    </label>
                    <input
                      type="email"
                      value={generalForm.notificationEmail}
                      onChange={(e) => setGeneralForm({ ...generalForm, notificationEmail: e.target.value })}
                      className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <span className="font-semibold text-slate-300 uppercase tracking-wider block mb-1">
                    Automated Event Alerts
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={generalForm.notifyOnRunComplete}
                      onChange={(e) => setGeneralForm({ ...generalForm, notifyOnRunComplete: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span className="text-slate-300">Dispatch desktop notification when benchmark runs finish grading</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={generalForm.notifyOnValidationFail}
                      onChange={(e) => setGeneralForm({ ...generalForm, notifyOnValidationFail: e.target.checked })}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span className="text-slate-300">Alert immediately if an automated benchmark validation check fails</span>
                  </label>
                </div>

                <div className="pt-4 border-t border-slate-800 flex justify-end">
                  <button
                    onClick={() => addToast({ title: 'Settings Saved', message: 'General preferences updated.', type: 'success' })}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI PROVIDERS (BYOK LLMs) */}
          {activeTab === 'providers' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-800/40 text-xs text-indigo-300 space-y-1">
                <div className="flex items-center gap-2 font-bold text-indigo-200">
                  <Sparkles className="h-4 w-4 text-indigo-400" />
                  <span>Bring Your Own Key (BYOK) — TaskForge Synthesis Core</span>
                </div>
                <p className="leading-relaxed">
                  These LLM providers power <strong>repository interpretation, feature discovery, task specification writing, reference implementation generation, and hidden test authoring</strong>. They are distinct from the coding agent runtimes evaluated by the platform.
                </p>
              </div>

              <div className="space-y-4">
                {providers.map((prov) => (
                  <div key={prov.id} className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{prov.name}</h4>
                          {prov.isDefault && (
                            <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              Default Provider
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{prov.description}</p>
                      </div>
                      <StatusBadge status={prov.status} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          API Key (Masked BYOK)
                        </label>
                        <input
                          type="text"
                          value={prov.apiKey}
                          readOnly
                          className="w-full rounded-lg bg-[#111827] border border-slate-700 py-1.5 px-3 font-mono text-slate-300"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Synthesis Model
                        </label>
                        <select
                          value={prov.model}
                          onChange={(e) => updateProvider(prov.id, { model: e.target.value })}
                          className="w-full rounded-lg bg-[#111827] border border-slate-700 py-1.5 px-3 text-white font-mono focus:outline-none"
                        >
                          {(prov.models || [prov.model]).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-500 font-mono">
                        Base URL: {prov.baseUrl}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTestProvider(prov.id)}
                          disabled={testingProviderId === prov.id}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
                        >
                          <RefreshCw className={`h-3 w-3 ${testingProviderId === prov.id ? 'animate-spin text-indigo-400' : ''}`} />
                          <span>{testingProviderId === prov.id ? 'Testing...' : 'Test Connection'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: CODING AGENT INTEGRATIONS */}
          {activeTab === 'agents' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 space-y-1">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Bot className="h-4 w-4 text-indigo-400" />
                  <span>Autonomous Coding Agent Execution Runtimes</span>
                </div>
                <p className="leading-relaxed">
                  These represent the autonomous agent harnesses evaluated by TaskForge. Do not confuse a generic LLM API key with an agent execution container.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {agents.map((agent) => (
                  <div key={agent.id} className="p-5 rounded-xl bg-[#0f172a] border border-slate-800 flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{agent.name}</h4>
                        <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-slate-800 text-slate-300">
                          {agent.provider}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{agent.description}</p>
                      <div className="mt-3 flex items-center gap-4 text-xs font-mono text-slate-400">
                        <span>Mode: <strong className="text-slate-200">{agent.supportedExecutionMode}</strong></span>
                        <span>Evaluations: <strong className="text-white">{agent.runsEvaluated}</strong></span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={agent.integrationStatus === 'connected' ? 'Ready' : 'Offline'} />
                      <button
                        onClick={() => addToast({ title: 'Agent Harness Pinged', message: `${agent.name} container daemon responded OK.`, type: 'info' })}
                        className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium"
                      >
                        Ping Daemon
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: EXECUTION ENVIRONMENTS */}
          {activeTab === 'environments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Reusable Environment Profiles</h3>
                  <p className="text-xs text-slate-400">Preconfigured container runtimes for isolated agent benchmark evaluations</p>
                </div>
                <button
                  onClick={() => {
                    createEnvironment({
                      name: 'Custom Polyglot Runtime',
                      runtime: 'Node.js + Go',
                      version: 'v20 / 1.22',
                      dockerImage: 'ghcr.io/taskforge-benchmarks/custom-polyglot:latest',
                      cpuLimit: '4 vCPUs',
                      memoryLimit: '8 GB RAM',
                      timeoutMinutes: 20,
                      networkAccess: 'Isolated',
                      description: 'Custom polyglot runtime profile'
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Profile</span>
                </button>
              </div>

              <div className="space-y-3">
                {environments.map((env) => (
                  <div key={env.id} className="p-4 rounded-xl bg-[#0f172a] border border-slate-800 flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{env.name}</h4>
                        {env.isDefault && (
                          <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Default Profile
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{env.description}</p>
                      <div className="mt-3 flex items-center gap-4 text-xs font-mono text-slate-400">
                        <span>Image: <strong className="text-slate-300">{env.dockerImage}</strong></span>
                        <span>Limits: <strong className="text-indigo-400">{env.cpuLimit} / {env.memoryLimit}</strong></span>
                      </div>
                    </div>

                    {!env.isDefault && (
                      <button
                        onClick={() => deleteEnvironment(env.id)}
                        className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: BENCHMARK DEFAULTS */}
          {activeTab === 'defaults' && (
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-5">
              <div className="pb-3 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">Default Benchmark Parameters</h3>
                <p className="text-xs text-slate-400">Set standardized limits and scoring formulas for newly generated benchmarks</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Default Complexity Tier
                  </label>
                  <select
                    value={benchmarkDefaults.defaultComplexity}
                    onChange={(e) => setBenchmarkDefaults({ ...benchmarkDefaults, defaultComplexity: e.target.value })}
                    className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-white focus:outline-none"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                    <option value="Expert">Expert</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Agent Execution Timeout
                  </label>
                  <input
                    type="number"
                    value={benchmarkDefaults.defaultTimeoutMinutes}
                    onChange={(e) => setBenchmarkDefaults({ ...benchmarkDefaults, defaultTimeoutMinutes: Number(e.target.value) })}
                    className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <span className="font-semibold text-slate-300 uppercase tracking-wider block mb-2 text-xs">
                  Provisional Scoring Component Weights (Must Sum to 100%)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px] uppercase">Functional Correctness</span>
                    <strong className="text-white text-base">60%</strong>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px] uppercase">Regression Safety</span>
                    <strong className="text-white text-base">25%</strong>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px] uppercase">Code Quality</span>
                    <strong className="text-white text-base">10%</strong>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-400 block text-[10px] uppercase">Execution Reliability</span>
                    <strong className="text-white text-base">5%</strong>
                  </div>
                </div>
              </div>

              <div className="pt-3 flex justify-end">
                <button
                  onClick={() => addToast({ title: 'Defaults Updated', message: 'Benchmark creation parameters saved.', type: 'success' })}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs"
                >
                  Save Defaults
                </button>
              </div>
            </div>
          )}

          {/* TAB 6: STORAGE & USAGE */}
          {activeTab === 'storage' && (
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-5">
              <div className="pb-3 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">Storage & Provider Usage Metrics</h3>
                <p className="text-xs text-slate-400">Disk consumption and simulated BYOK API expenditure</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block uppercase tracking-wider text-[10px]">Repository Storage</span>
                  <div className="text-xl font-bold font-mono text-white mt-1">4.2 GB</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">8 cached git worktrees</div>
                </div>

                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block uppercase tracking-wider text-[10px]">Artifacts & Diffs</span>
                  <div className="text-xl font-bold font-mono text-indigo-400 mt-1">1.8 GB</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">412 agent submissions</div>
                </div>

                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block uppercase tracking-wider text-[10px]">LLM Provider Usage</span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-1">4.8M Tokens</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Simulated BYOK tokens</div>
                </div>

                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block uppercase tracking-wider text-[10px]">Est. Provider Spend</span>
                  <div className="text-xl font-bold font-mono text-white mt-1">$4.12</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Billed to your provider keys</div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
                <strong>Notice:</strong> All figures above reflect simulated operational prototype state. No real billing accounts are connected.
              </div>
            </div>
          )}

          {/* TAB 7: SECURITY */}
          {activeTab === 'security' && (
            <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-4 text-xs">
              <div className="pb-3 border-b border-slate-800">
                <h3 className="text-base font-bold text-white">Security & Secret Masking</h3>
                <p className="text-slate-400">Sandbox isolation, credential handling, and access restrictions</p>
              </div>

              <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-emerald-300 space-y-1">
                <h4 className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Client-Side Secret Masking Active</span>
                </h4>
                <p className="text-[11px] leading-relaxed">
                  All LLM API keys and private repo tokens are strictly masked in the DOM. Credentials reside solely in local memory and are never transmitted to unauthorized external origins.
                </p>
              </div>

              <div className="divide-y divide-slate-800">
                <div className="py-3 flex justify-between">
                  <span className="text-slate-400">Sandbox Container Isolation</span>
                  <span className="text-emerald-400 font-mono font-bold">ENFORCED (Docker Cgroups)</span>
                </div>
                <div className="py-3 flex justify-between">
                  <span className="text-slate-400">Network Egress Filter</span>
                  <span className="text-slate-300 font-mono">Allowlist Only (Registries)</span>
                </div>
                <div className="py-3 flex justify-between">
                  <span className="text-slate-400">Hidden Test Masking</span>
                  <span className="text-emerald-400 font-mono font-bold">STRICT (Zero Agent Exposure)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
