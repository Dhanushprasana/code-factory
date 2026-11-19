import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  Cpu,
  ArrowLeft,
  ArrowRight,
  Check,
  GitBranch,
  Sparkles,
  RefreshCw,
  Plus,
  Trash2,
  FileCode2,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  EyeOff,
  Layers,
  Save,
  Send,
  Sliders,
  Code2
} from 'lucide-react';

export const CreateBenchmarkWizard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { repositories, createBenchmark, addToast } = useApp();

  const preselectedRepoId = searchParams.get('repoId') || repositories[0]?.id;

  // Wizard Step State (1 to 8)
  const [currentStep, setCurrentStep] = useState(1);

  // STEP 1: Selected Repository
  const [selectedRepoId, setSelectedRepoId] = useState(preselectedRepoId);
  const selectedRepo = repositories.find((r) => r.id === selectedRepoId) || repositories[0];

  // STEP 2: Configure Feature Discovery
  const [discoveryConfig, setDiscoveryConfig] = useState({
    category: 'E-commerce',
    complexity: 'Medium',
    targetModules: ['Cart', 'Checkout', 'Discounts'],
    excludedModules: ['Admin Analytics'],
    preferredArea: 'Full Stack Service & Controller',
    customNotes: 'Focus on atomic usage tracking and state persistence.',
  });

  // STEP 3: Feature Discovery Results & Selection
  const mockSuggestions = [
    {
      id: 'sug-1',
      title: 'Tiered Coupon & Promotional Discount Rules',
      description: 'Extend checkout and cart pricing pipelines with dynamic coupon codes, min spend thresholds, and usage limits.',
      fit: 'Directly extends existing cartController and models with minimal architectural overhead.',
      modules: ['server/controllers/cartController.js', 'src/components/CartDrawer.jsx', 'server/models/Coupon.js'],
      complexity: 'Medium',
      impact: 'High business leverage; requires transaction isolation to avoid promo double-redemption.',
      acceptancePreview: ['Valid code applies 20% discount', 'Expired code returns HTTP 422', 'Single-use prevents race conditions']
    },
    {
      id: 'sug-2',
      title: 'Persistent User Wishlist Collection',
      description: 'Introduce WishlistItem models and optimistic React state allowing shoppers to bookmark catalog items.',
      fit: 'Matches the current user session model and provides standard CRUD evaluation scope.',
      modules: ['src/components/ProductCard.jsx', 'server/models/Wishlist.js'],
      complexity: 'Easy',
      impact: 'User engagement; tests basic model association and route guards.',
      acceptancePreview: ['Heart toggle saves item', 'Unauthenticated clicks redirect to login']
    },
    {
      id: 'sug-3',
      title: 'Verified Customer Reviews & Rating Engine',
      description: 'Allow verified purchasers to leave star ratings, text feedback, and compute running average ratings.',
      fit: 'Leverages existing Order and Product relational models.',
      modules: ['server/controllers/reviewController.js', 'src/pages/Catalog.jsx'],
      complexity: 'Medium',
      impact: 'Tests data aggregation, input sanitization against XSS, and authorization checks.',
      acceptancePreview: ['Only buyers can review', 'Star rating updates immediately']
    },
    {
      id: 'sug-4',
      title: 'Real-time Stock Hold Under Concurrency',
      description: 'Implement expirable inventory reservations during checkout to prevent inventory overselling.',
      fit: 'Addresses high-concurrency race condition scenarios.',
      modules: ['server/controllers/inventoryController.js', 'server/models/Product.js'],
      complexity: 'Hard',
      impact: 'Critical transaction safety; requires SELECT FOR UPDATE or Redis locks.',
      acceptancePreview: ['Zero overselling under 100 concurrent checkout calls', 'Automatic hold TTL expiry']
    }
  ];

  const [selectedFeature, setSelectedFeature] = useState(mockSuggestions[0]);

  // STEP 4: Task Specification Editor
  const [taskSpec, setTaskSpec] = useState({
    title: 'Implement Tiered Coupon Codes & Cart Discount Rules',
    problemStatement: 'The current platform calculates cart totals without promotional coupon discounts. Customers require valid promo codes to deduct fixed percentage or dollar amounts before checkout.',
    featureDescription: 'Extend the cart pricing service and coupon controller to support validated coupons with usage limits, expiration dates, minimum cart spend, and category exclusions.',
    functionalRequirements: [
      'Create POST /api/coupons/apply endpoint validating code, active status, and min cart value.',
      'Update cart total calculation in server/controllers/cartController.js to apply percentage discounts.',
      'Store applied coupon reference in the active cart state.',
      'Render CouponBadge and discount subtotal in the frontend CartDrawer.'
    ],
    nonFunctionalRequirements: 'Calculation response time < 15ms. Zero database deadlocks during checkout.',
    technicalConstraints: 'Must use existing Sequelize Coupon and Cart models without altering Stripe payload.',
    acceptanceCriteria: [
      "Valid promo code 'SAVE20' reduces qualifying cart subtotal by 20%.",
      "Expired coupons return HTTP 422 with { error: 'COUPON_EXPIRED' }.",
      "Carts below minimum purchase threshold reject coupon with { error: 'MIN_SPEND_NOT_MET' }.",
      "Single-use coupon cannot be redeemed twice by the same customer ID.",
      "Total cart price never drops below $0.00."
    ],
    edgeCases: 'Applying coupon to excluded items; Cart drops below threshold after item removal.',
    expectedBehavior: 'Instant cart recalculation, coupon badge displayed, and atomic lock during checkout.',
    startingCommitSha: selectedRepo.lastAnalyzedCommit || 'c4a9f21',
  });

  // STEP 5: Reference Implementation
  const [refDiffSelectedFile, setRefDiffSelectedFile] = useState('server/controllers/couponController.js');

  // STEP 6: Hidden Tests
  const hiddenTestCases = [
    { id: 't1', category: 'Functional', name: 'Applies 20% discount accurately to multi-item cart', hidden: true },
    { id: 't2', category: 'Acceptance Criteria', name: 'Returns HTTP 422 with COUPON_EXPIRED for past expiration date', hidden: true },
    { id: 't3', category: 'Boundary Condition', name: 'Cart total clamped at $0.00 if discount exceeds merchandise value', hidden: true },
    { id: 't4', category: 'Edge-Case', name: 'Invalidates coupon if item removal drops total below minimum spend', hidden: true },
    { id: 't5', category: 'Regression Test', name: 'Existing tax and shipping hooks continue to evaluate unchanged', hidden: true },
    { id: 't6', category: 'Concurrency Safety', name: 'Parallel requests cannot double-redeem a coupon with 1 remaining use', hidden: true },
  ];

  // STEP 7: Benchmark Validation Checks
  const [validating, setValidating] = useState(false);
  const [validationProgress, setValidationProgress] = useState(100);
  const [validationChecks, setValidationChecks] = useState([
    { id: 1, name: 'Specification Completeness', status: 'passed', desc: 'All 10 required spec fields present with acceptance criteria.' },
    { id: 2, name: 'Reference Implementation Execution', status: 'passed', desc: 'Reference patch cleanly builds and serves HTTP 200.' },
    { id: 3, name: 'Feature Test Execution', status: 'passed', desc: 'All 22 hidden verification tests pass against reference solution.' },
    { id: 4, name: 'Regression Test Execution', status: 'passed', desc: 'Existing 86 repo test cases pass with zero regressions.' },
    { id: 5, name: 'Acceptance Criteria Coverage', status: 'passed', desc: '100% of acceptance criteria covered by dedicated tests.' },
    { id: 6, name: 'Test Quality & Isolation', status: 'passed', desc: 'Hidden tests execute in isolated sandbox without leaking test files.' },
    { id: 7, name: 'Repository Compatibility', status: 'passed', desc: 'Compatible with Node.js 18 & 20 runtime profiles.' },
    { id: 8, name: 'Reproducibility Check', status: 'passed', desc: 'Five consecutive clean environment runs produced identical passes.' },
  ]);

  const runValidationSimulation = () => {
    setValidating(true);
    setValidationProgress(20);
    setTimeout(() => setValidationProgress(60), 600);
    setTimeout(() => {
      setValidationProgress(100);
      setValidating(false);
      addToast({
        title: 'Validation Complete',
        message: '8 of 8 benchmark verification checks passed successfully.',
        type: 'success'
      });
    }, 1200);
  };

  // Requirement & Criteria helpers
  const handleAddCriteria = () => {
    setTaskSpec({
      ...taskSpec,
      acceptanceCriteria: [...taskSpec.acceptanceCriteria, 'New testable acceptance condition.']
    });
  };

  const handleRemoveCriteria = (index) => {
    setTaskSpec({
      ...taskSpec,
      acceptanceCriteria: taskSpec.acceptanceCriteria.filter((_, idx) => idx !== index)
    });
  };

  // STEP 8: Publish
  const handlePublish = () => {
    const published = createBenchmark({
      name: taskSpec.title,
      repositoryId: selectedRepo.id,
      repositoryName: selectedRepo.name,
      projectId: selectedRepo.projectId,
      projectName: selectedRepo.projectName,
      featureCategory: discoveryConfig.category,
      complexity: discoveryConfig.complexity,
      status: 'Ready',
      taskSpecification: taskSpec,
      referenceImplementation: {
        summary: `Reference implementation for ${taskSpec.title}`,
        modifiedFiles: ['src/components/CartDrawer.jsx', 'server/controllers/cartController.js'],
        addedFiles: ['server/models/Coupon.js', 'server/controllers/couponController.js'],
        deletedFiles: [],
        diffStats: { additions: 342, deletions: 28 },
        diffPreview: []
      },
      hiddenTests: {
        testSuiteName: `${taskSpec.title}-Hidden-Suite`,
        testCount: 22,
        framework: 'Vitest / Supertest',
        status: 'Verified',
        testCases: hiddenTestCases
      },
      validationReport: {
        overallPercentage: 100,
        passedChecks: 8,
        failedChecks: 0,
        warnings: 0,
        checks: validationChecks,
        summary: 'All automated specification and test isolation checks passed cleanly.'
      }
    });

    navigate(`/benchmarks/${published.id}`);
  };

  const stepLabels = [
    'Select Repository',
    'Configure Discovery',
    'Feature Suggestions',
    'Task Specification',
    'Reference Solution',
    'Hidden Tests',
    'Validation',
    'Publish Benchmark'
  ];

  return (
    <div className="space-y-6">
      {/* Back button and page header */}
      <div>
        <button
          onClick={() => navigate('/benchmarks')}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Cancel & Return to Benchmark Factory</span>
        </button>

        <PageHeader
          title="Create Benchmark"
          description="Synthesize a new coding benchmark: from repository analysis to hidden test generation and validation."
          badge={
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              Step {currentStep} of 8
            </span>
          }
        />
      </div>

      {/* Progress Wizard Bar */}
      <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {stepLabels.map((label, idx) => {
            const stepNum = idx + 1;
            const isCompleted = stepNum < currentStep;
            const isCurrent = stepNum === currentStep;

            return (
              <button
                key={label}
                disabled={stepNum > currentStep + 1}
                onClick={() => setCurrentStep(stepNum)}
                className={`flex flex-col text-left p-2 rounded-lg border transition-all ${
                  isCurrent
                    ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-sm'
                    : isCompleted
                    ? 'bg-slate-900/60 border-emerald-500/30 text-slate-300'
                    : 'bg-slate-900/30 border-slate-800 text-slate-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold">0{stepNum}</span>
                  {isCompleted && <Check className="h-3 w-3 text-emerald-400" />}
                </div>
                <span className="text-xs font-semibold truncate mt-1">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* STEP 1: SELECT REPOSITORY */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Select Connected Repository</h3>
              <p className="text-xs text-slate-400">Choose the codebase that will serve as the benchmark foundation</p>
            </div>
            <span className="text-xs text-slate-400 font-mono">1 Selected</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {repositories.map((repo) => {
              const isSelected = repo.id === selectedRepoId;
              return (
                <div
                  key={repo.id}
                  onClick={() => setSelectedRepoId(repo.id)}
                  className={`p-5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-indigo-950/20 border-indigo-500 ring-1 ring-indigo-500 shadow-xl'
                      : 'bg-[#0f172a] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                          <GitBranch className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white">{repo.name}</h4>
                          <span className="text-xs text-slate-400">{repo.projectName}</span>
                        </div>
                      </div>
                      <StatusBadge status={repo.analysisStatus || 'Completed'} />
                    </div>

                    <p className="text-xs text-slate-300 mt-3 line-clamp-2 leading-relaxed">
                      {repo.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {(repo.frameworks || []).slice(0, 3).map((f) => (
                        <span key={f} className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                    <span>Commit: <strong className="font-mono text-indigo-400">{repo.lastAnalyzedCommit}</strong></span>
                    <span>Branch: <strong className="text-slate-200">{repo.branch}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 2: CONFIGURE FEATURE DISCOVERY */}
      {currentStep === 2 && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">Configure Feature Discovery</h3>
            <p className="text-xs text-slate-400">Instruct the LLM provider on what kind of benchmark extension to formulate</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Feature Domain / Category *
                </label>
                <select
                  value={discoveryConfig.category}
                  onChange={(e) => setDiscoveryConfig({ ...discoveryConfig, category: e.target.value })}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="E-commerce">E-commerce & Pricing</option>
                  <option value="Authentication">Authentication & Identity</option>
                  <option value="Authorization">Authorization & RBAC</option>
                  <option value="Payments">Payments & Billing</option>
                  <option value="User Management">User Management & Profiles</option>
                  <option value="Notifications">Notifications & Fanout</option>
                  <option value="Performance">Performance & Concurrency</option>
                  <option value="Security">Security & Cryptography</option>
                  <option value="API Development">API Development & Microservices</option>
                  <option value="Custom">Custom Domain</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Target Complexity Tier *
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {['Easy', 'Medium', 'Hard', 'Expert'].map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setDiscoveryConfig({ ...discoveryConfig, complexity: tier })}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                        discoveryConfig.complexity === tier
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                          : 'bg-[#111827] border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Preferred Architectural Scope
                </label>
                <input
                  type="text"
                  value={discoveryConfig.preferredArea}
                  onChange={(e) => setDiscoveryConfig({ ...discoveryConfig, preferredArea: e.target.value })}
                  placeholder="e.g. Full Stack Service & Controller"
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Additional Constraints & Instructions
                </label>
                <textarea
                  rows={4}
                  value={discoveryConfig.customNotes}
                  onChange={(e) => setDiscoveryConfig({ ...discoveryConfig, customNotes: e.target.value })}
                  placeholder="Specify rules: e.g. Do not modify public checkout schemas, prevent race conditions..."
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-3.5 rounded-lg bg-indigo-950/20 border border-indigo-800/40 text-xs text-indigo-300 flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                <p>
                  TaskForge AI Provider (Google Gemini / OpenRouter) will inspect the AST and APIs of <strong>{selectedRepo.name}</strong> to synthesize realistic feature tasks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: FEATURE DISCOVERY RESULTS */}
      {currentStep === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Synthesized Feature Opportunities</h3>
              <p className="text-xs text-slate-400">Select one feature to convert into a formalized coding benchmark</p>
            </div>
            <button
              onClick={() => {
                addToast({
                  title: 'Suggestions Regenerated',
                  message: 'Generated 4 fresh feature candidates from repo context.',
                  type: 'info'
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300"
            >
              <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
              <span>Regenerate</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mockSuggestions.map((sug) => {
              const isSelected = selectedFeature.id === sug.id;
              return (
                <div
                  key={sug.id}
                  onClick={() => {
                    setSelectedFeature(sug);
                    setTaskSpec({
                      ...taskSpec,
                      title: sug.title,
                      featureDescription: sug.description,
                    });
                  }}
                  className={`p-5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-indigo-950/20 border-indigo-500 ring-1 ring-indigo-500 shadow-xl'
                      : 'bg-[#0f172a] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <h4 className="text-sm font-bold text-white">{sug.title}</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                        {sug.complexity}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                      {sug.description}
                    </p>

                    <div className="mt-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                      <div><strong className="text-slate-300">Why it fits:</strong> {sug.fit}</div>
                      <div><strong className="text-slate-300">Impact:</strong> {sug.impact}</div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
                      Target Modules
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {sug.modules.map((m) => (
                        <span key={m} className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 4: TASK SPECIFICATION EDITOR */}
      {currentStep === 4 && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white">Structured Task Specification Editor</h3>
              <p className="text-xs text-slate-400">Refine the exact prompt and constraints that participating agents will receive</p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Commit SHA: {taskSpec.startingCommitSha}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Task Title *
              </label>
              <input
                type="text"
                value={taskSpec.title}
                onChange={(e) => setTaskSpec({ ...taskSpec, title: e.target.value })}
                className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Problem Statement
              </label>
              <textarea
                rows={2}
                value={taskSpec.problemStatement}
                onChange={(e) => setTaskSpec({ ...taskSpec, problemStatement: e.target.value })}
                className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Acceptance Criteria Interactive List */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Acceptance Criteria ({taskSpec.acceptanceCriteria.length})
                </label>
                <button
                  type="button"
                  onClick={handleAddCriteria}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Criterion</span>
                </button>
              </div>

              <div className="space-y-2">
                {taskSpec.acceptanceCriteria.map((crit, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-500 w-5">{idx + 1}.</span>
                    <input
                      type="text"
                      value={crit}
                      onChange={(e) => {
                        const updated = [...taskSpec.acceptanceCriteria];
                        updated[idx] = e.target.value;
                        setTaskSpec({ ...taskSpec, acceptanceCriteria: updated });
                      }}
                      className="flex-1 rounded-lg bg-[#111827] border border-slate-700 py-1.5 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveCriteria(idx)}
                      className="p-1.5 rounded text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Non-Functional Requirements
                </label>
                <input
                  type="text"
                  value={taskSpec.nonFunctionalRequirements}
                  onChange={(e) => setTaskSpec({ ...taskSpec, nonFunctionalRequirements: e.target.value })}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Technical Constraints
                </label>
                <input
                  type="text"
                  value={taskSpec.technicalConstraints}
                  onChange={(e) => setTaskSpec({ ...taskSpec, technicalConstraints: e.target.value })}
                  className="w-full rounded-lg bg-[#111827] border border-slate-700 py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5: REFERENCE IMPLEMENTATION */}
      {currentStep === 5 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Generated Reference Solution</h3>
              <p className="text-xs text-slate-400">Ground-truth code patch used to verify benchmark feasibility and test suites</p>
            </div>
            <StatusBadge status="Ready" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 rounded-xl bg-[#0f172a] border border-slate-800 p-5">
            <div className="border-r border-slate-800 pr-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Modified & Added Files</h4>
              <div className="space-y-1 font-mono text-xs">
                {[
                  { file: 'server/controllers/couponController.js', status: 'added' },
                  { file: 'server/models/Coupon.js', status: 'added' },
                  { file: 'server/controllers/cartController.js', status: 'modified' },
                  { file: 'src/components/CartDrawer.jsx', status: 'modified' },
                ].map((f) => (
                  <button
                    key={f.file}
                    type="button"
                    onClick={() => setRefDiffSelectedFile(f.file)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                      refDiffSelectedFile === f.file
                        ? 'bg-indigo-600/20 text-indigo-300 font-bold border border-indigo-500/30'
                        : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <span className="truncate">{f.file}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-sans uppercase ${
                      f.status === 'added' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {f.status}
                    </span>
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-800 text-xs text-slate-400 space-y-1">
                <div>Additions: <strong className="text-emerald-400 font-mono">+342 lines</strong></div>
                <div>Deletions: <strong className="text-rose-400 font-mono">-28 lines</strong></div>
              </div>
            </div>

            <div className="md:col-span-2 pl-2">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3 text-xs font-mono text-slate-400">
                <span>diff --git a/{refDiffSelectedFile} b/{refDiffSelectedFile}</span>
                <span className="text-emerald-400">Validated Patch</span>
              </div>

              <div className="p-4 rounded-lg bg-[#090d16] border border-slate-800 font-mono text-xs space-y-1 overflow-x-auto max-h-[380px]">
                <div className="text-slate-500">@@ -0,0 +1,32 @@</div>
                <div className="text-emerald-400">{"+ const { Coupon, Cart } = require('../models');"}</div>
                <div className="text-emerald-400">{"+ exports.applyCouponCode = async (req, res) => {"}</div>
                <div className="text-emerald-400">{"+   const { code, cartId } = req.body;"}</div>
                <div className="text-emerald-400">{"+   const coupon = await Coupon.findOne({ where: { code: code.toUpperCase() } });"}</div>
                <div className="text-emerald-400">{"+   if (!coupon) return res.status(404).json({ error: 'COUPON_NOT_FOUND' });"}</div>
                <div className="text-emerald-400">{"+   if (new Date() > new Date(coupon.expiresAt)) {"}</div>
                <div className="text-emerald-400">{"+     return res.status(422).json({ error: 'COUPON_EXPIRED' });"}</div>
                <div className="text-emerald-400">{"+   }"}</div>
                <div className="text-slate-400">    // Apply calculated discount to cart total</div>
                <div className="text-emerald-400">{"+   return res.json({ success: true, discountAmount: coupon.discount });"}</div>
                <div className="text-emerald-400">{"+ };"}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: HIDDEN TESTS GENERATION */}
      {currentStep === 6 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Hidden Verification Test Suites</h3>
              <p className="text-xs text-slate-400">Independent test suite to evaluate participating agents without leaking source test cases</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-xs">
              <EyeOff className="h-3.5 w-3.5" />
              <span>Strictly Hidden From Agents</span>
            </div>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h4 className="text-sm font-semibold text-white">ShopSphere-Coupon-Hidden-Verification-Suite</h4>
                <p className="text-xs text-slate-400">Framework: Vitest / Supertest • Total Tests: 22</p>
              </div>
              <StatusBadge status="Ready" />
            </div>

            <div className="divide-y divide-slate-800/60 text-xs">
              {hiddenTestCases.map((tc) => (
                <div key={tc.id} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                      {tc.category}
                    </span>
                    <span className="text-slate-200">{tc.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Verified</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">
              <strong>Evaluation Isolation Guarantee:</strong> Agents will only receive the Task Specification and baseline repository. Hidden tests are injected at the evaluation step inside a pristine Docker container.
            </div>
          </div>
        </div>
      )}

      {/* STEP 7: BENCHMARK VALIDATION */}
      {currentStep === 7 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Automated Benchmark Validation</h3>
              <p className="text-xs text-slate-400">8-point integrity verification across specification, patch, and test suites</p>
            </div>
            <button
              onClick={runValidationSimulation}
              disabled={validating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${validating ? 'animate-spin' : ''}`} />
              <span>{validating ? 'Validating...' : 'Run Full Validation'}</span>
            </button>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Overall Validation Result: <strong className="text-emerald-400 font-mono">100% Passed (8/8)</strong>
              </span>
              <span className="text-xs text-slate-400">Deterministic Sandbox Profile</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {validationChecks.map((chk) => (
                <div key={chk.id} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-start gap-3">
                  <div className="h-6 w-6 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 border border-emerald-500/30">
                    <Check className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-white">{chk.name}</h5>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{chk.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* STEP 8: PUBLISH BENCHMARK */}
      {currentStep === 8 && (
        <div className="rounded-xl bg-[#0f172a] border border-slate-800 p-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white">Publish Benchmark Package</h3>
              <p className="text-xs text-slate-400">Review final benchmark metadata and publish to version v1.0.0</p>
            </div>
            <StatusBadge status="Ready" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-400 block mb-1">Target Repo</span>
              <strong className="text-white text-sm">{selectedRepo.name}</strong>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-400 block mb-1">Complexity</span>
              <strong className="text-indigo-400 text-sm">{discoveryConfig.complexity}</strong>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-400 block mb-1">Hidden Tests</span>
              <strong className="text-white text-sm">22 Test Cases</strong>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-400 block mb-1">Validation</span>
              <strong className="text-emerald-400 text-sm">100% Passed</strong>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-indigo-950/20 border border-indigo-800/40 text-xs text-indigo-300">
            <strong>Ready for Execution:</strong> Once published, this benchmark will be immediately selectable in the <strong>Benchmark Runner</strong> to dispatch multi-agent executions.
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              onClick={() => {
                addToast({
                  title: 'Draft Saved',
                  message: 'Benchmark saved as draft in local state.',
                  type: 'info'
                });
                navigate('/benchmarks');
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
            >
              <Save className="h-4 w-4" />
              <span>Save as Draft</span>
            </button>

            <button
              onClick={handlePublish}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20"
            >
              <Send className="h-4 w-4" />
              <span>Publish Benchmark (v1.0.0)</span>
            </button>
          </div>
        </div>
      )}

      {/* Wizard Bottom Navigation Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          disabled={currentStep === 1}
          onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0f172a] hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Previous Step</span>
        </button>

        {currentStep < 8 ? (
          <button
            type="button"
            onClick={() => setCurrentStep((prev) => Math.min(8, prev + 1))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <span>Continue</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
};
