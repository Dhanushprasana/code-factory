import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  mockProjects,
  mockRepositories,
  mockAgents,
  mockBenchmarks,
  mockRuns,
  mockEvaluations,
  mockLeaderboard,
  mockActivities,
  mockNotifications,
  mockProviders,
  mockEnvironments
} from '../data';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  // Load from localStorage if present or fall back to mock data
  const [projects, setProjects] = useState(() => {
    const saved = localStorage.getItem('taskforge_projects');
    return saved ? JSON.parse(saved) : mockProjects;
  });

  const [selectedProjectId, setSelectedProjectId] = useState('all');

  const [repositories, setRepositories] = useState(() => {
    const saved = localStorage.getItem('taskforge_repos');
    return saved ? JSON.parse(saved) : mockRepositories;
  });

  const [benchmarks, setBenchmarks] = useState(() => {
    const saved = localStorage.getItem('taskforge_benchmarks');
    return saved ? JSON.parse(saved) : mockBenchmarks;
  });

  const [runs, setRuns] = useState(() => {
    const saved = localStorage.getItem('taskforge_runs');
    return saved ? JSON.parse(saved) : mockRuns;
  });

  const [evaluations, setEvaluations] = useState(() => {
    const saved = localStorage.getItem('taskforge_evaluations');
    return saved ? JSON.parse(saved) : mockEvaluations;
  });

  const [activities, setActivities] = useState(() => {
    const saved = localStorage.getItem('taskforge_activities');
    return saved ? JSON.parse(saved) : mockActivities;
  });

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('taskforge_notifs');
    return saved ? JSON.parse(saved) : mockNotifications;
  });

  const [providers, setProviders] = useState(() => {
    const saved = localStorage.getItem('taskforge_providers');
    return saved ? JSON.parse(saved) : mockProviders;
  });

  const [environments, setEnvironments] = useState(() => {
    const saved = localStorage.getItem('taskforge_environments');
    return saved ? JSON.parse(saved) : mockEnvironments;
  });

  const [toasts, setToasts] = useState([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  // Sync state changes to localStorage
  useEffect(() => {
    localStorage.setItem('taskforge_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('taskforge_repos', JSON.stringify(repositories));
  }, [repositories]);

  useEffect(() => {
    localStorage.setItem('taskforge_benchmarks', JSON.stringify(benchmarks));
  }, [benchmarks]);

  useEffect(() => {
    localStorage.setItem('taskforge_runs', JSON.stringify(runs));
  }, [runs]);

  useEffect(() => {
    localStorage.setItem('taskforge_evaluations', JSON.stringify(evaluations));
  }, [evaluations]);

  useEffect(() => {
    localStorage.setItem('taskforge_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // Toast dispatch
  const addToast = ({ title, message, type = 'info', duration = 4000 }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Add an activity record
  const addActivity = (act) => {
    const newAct = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user: 'Current User',
      badge: 'info',
      ...act,
    };
    setActivities((prev) => [newAct, ...prev]);
  };

  // Create Project
  const createProject = (projectData) => {
    const newProject = {
      id: `proj-${Date.now()}`,
      name: projectData.name,
      description: projectData.description || 'No description provided.',
      repositoryCount: 0,
      benchmarkCount: 0,
      executionCount: 0,
      averageScore: 0,
      lastActivity: new Date().toISOString(),
      status: 'active',
      tags: projectData.tags || ['Custom'],
    };
    setProjects((prev) => [newProject, ...prev]);
    addActivity({
      type: 'project_created',
      title: 'Project Initialized',
      description: `Created project '${newProject.name}'.`,
      entityType: 'project',
      entityId: newProject.id,
      badge: 'neutral'
    });
    addToast({
      title: 'Project Created',
      message: `Project "${newProject.name}" has been created successfully.`,
      type: 'success'
    });
    return newProject;
  };

  // Connect Repository
  const connectRepository = (repoData) => {
    const newRepo = {
      id: `repo-${Date.now()}`,
      projectId: repoData.projectId || (projects[0]?.id || 'proj-1'),
      projectName: projects.find((p) => p.id === (repoData.projectId || projects[0]?.id))?.name || 'Default Project',
      name: repoData.name,
      description: repoData.description || 'Connected repository',
      sourceType: repoData.sourceType || 'github',
      sourceUrl: repoData.sourceUrl || repoData.name,
      primaryLanguage: repoData.primaryLanguage || 'JavaScript',
      frameworks: repoData.frameworks || ['React', 'Node.js', 'Express'],
      branch: repoData.branch || 'main',
      lastAnalyzedCommit: repoData.startingCommit || 'a1b2c3d',
      commitMessage: 'Initial ingestion checkout',
      analysisStatus: 'completed',
      lastAnalyzed: new Date().toISOString(),
      stats: {
        stars: 12,
        forks: 3,
        fileCount: 142,
        codeLines: 18400,
        sizeMb: 8.4,
        testCoverage: '72.0%',
      },
      fileTree: [
        {
          name: 'src',
          type: 'directory',
          children: [
            { name: 'index.js', type: 'file', size: '1.2 KB', lines: 34 },
            { name: 'App.jsx', type: 'file', size: '3.4 KB', lines: 98 },
            { name: 'routes.js', type: 'file', size: '2.1 KB', lines: 58 }
          ]
        },
        {
          name: 'server',
          type: 'directory',
          children: [
            { name: 'app.js', type: 'file', size: '4.5 KB', lines: 120 },
            { name: 'controllers.js', type: 'file', size: '6.2 KB', lines: 180 }
          ]
        },
        { name: 'package.json', type: 'file', size: '1.5 KB', lines: 45 },
        { name: 'README.md', type: 'file', size: '2.4 KB', lines: 60 }
      ],
      architecture: {
        nodes: [
          { id: 'fe', label: 'Frontend Client', type: 'frontend', details: 'Web UI Layer' },
          { id: 'api', label: 'API Gateway', type: 'backend', details: 'REST Controllers' },
          { id: 'db', label: 'Database Service', type: 'database', details: 'Persistent Store' }
        ],
        edges: [
          { from: 'fe', to: 'api', label: 'HTTPS / JSON' },
          { from: 'api', to: 'db', label: 'Driver Connection' }
        ]
      },
      apis: [
        { method: 'GET', endpoint: '/api/v1/health', handler: 'checkHealth', sourceFile: 'server/app.js', module: 'System' },
        { method: 'GET', endpoint: '/api/v1/resources', handler: 'listResources', sourceFile: 'server/controllers.js', module: 'Resources' },
        { method: 'POST', endpoint: '/api/v1/resources', handler: 'createResource', sourceFile: 'server/controllers.js', module: 'Resources' },
      ],
      dataModels: [
        { name: 'Resource', sourceFile: 'server/models/Resource.js', fields: ['id (UUID)', 'title (VARCHAR)', 'createdAt (TIMESTAMP)'], relationships: [] }
      ],
      dependencies: [
        { package: 'react', version: '^18.3.1', type: 'production', purpose: 'UI Library' },
        { package: 'express', version: '^4.19.2', type: 'production', purpose: 'Server' }
      ],
      tests: {
        framework: 'Vitest',
        totalFiles: 4,
        totalDetectedCases: 22,
        availableCommands: ['npm test'],
        coverage: '72.0%',
        suites: [{ file: 'tests/main.test.js', cases: 22, status: 'passing' }]
      },
      analysisHistory: [
        { date: new Date().toISOString(), commitSha: repoData.startingCommit || 'a1b2c3d', filesScanned: 142, duration: '24s', status: 'completed', warnings: 0 }
      ]
    };

    setRepositories((prev) => [newRepo, ...prev]);

    // Update repository count on the project
    setProjects((prev) => prev.map((p) => {
      if (p.id === newRepo.projectId) {
        return { ...p, repositoryCount: p.repositoryCount + 1, lastActivity: new Date().toISOString() };
      }
      return p;
    }));

    addActivity({
      type: 'repo_connected',
      title: 'Repository Connected & Analyzed',
      description: `Connected ${newRepo.name} (${newRepo.sourceType}) and indexed 142 files.`,
      entityType: 'repository',
      entityId: newRepo.id,
      badge: 'info'
    });

    addToast({
      title: 'Repository Connected',
      message: `Repository "${newRepo.name}" ingested and analyzed successfully.`,
      type: 'success'
    });

    return newRepo;
  };

  // Re-analyze Repository (Simulated)
  const reanalyzeRepository = (repoId) => {
    setRepositories((prev) => prev.map((repo) => {
      if (repo.id === repoId) {
        const newHistory = [
          {
            date: new Date().toISOString(),
            commitSha: repo.lastAnalyzedCommit || 'c4a9f21',
            filesScanned: repo.stats.fileCount,
            duration: '26s',
            status: 'completed',
            warnings: 0
          },
          ...(repo.analysisHistory || [])
        ];
        return {
          ...repo,
          lastAnalyzed: new Date().toISOString(),
          analysisStatus: 'completed',
          analysisHistory: newHistory
        };
      }
      return repo;
    }));

    addToast({
      title: 'Analysis Complete',
      message: 'Repository codebase re-indexed. Dependencies, APIs, and models updated.',
      type: 'info'
    });
  };

  // Create Benchmark
  const createBenchmark = (benchData) => {
    const newBench = {
      id: `bench-${Date.now()}`,
      name: benchData.name,
      repositoryId: benchData.repositoryId,
      repositoryName: benchData.repositoryName,
      projectId: benchData.projectId,
      projectName: benchData.projectName,
      featureCategory: benchData.featureCategory || 'E-commerce',
      complexity: benchData.complexity || 'Medium',
      status: benchData.status || 'Ready',
      version: 'v1.0.0',
      executionCount: 0,
      createdDate: new Date().toISOString(),
      taskSpecification: benchData.taskSpecification || {},
      referenceImplementation: benchData.referenceImplementation || {
        summary: 'Reference implementation generated by TaskForge LLM provider.',
        modifiedFiles: ['src/components/Cart.jsx'],
        addedFiles: ['server/controllers/featureController.js'],
        deletedFiles: [],
        diffStats: { additions: 140, deletions: 12 },
        diffPreview: []
      },
      hiddenTests: benchData.hiddenTests || {
        testSuiteName: `${benchData.name}-Hidden-Tests`,
        testCount: 16,
        framework: 'Vitest / Supertest',
        status: 'Verified',
        testCases: [
          { id: 'ht-1', category: 'Functional', name: 'Primary requirement behavioral check', expected: 'Pass', isHidden: true },
          { id: 'ht-2', category: 'Boundary', name: 'Boundary parameter verification', expected: 'Pass', isHidden: true },
          { id: 'ht-3', category: 'Regression', name: 'Pre-existing regression test suite', expected: 'Pass', isHidden: true }
        ]
      },
      validationReport: benchData.validationReport || {
        overallPercentage: 100,
        passedChecks: 8,
        failedChecks: 0,
        warnings: 0,
        timestamp: new Date().toISOString(),
        summary: 'All automated specification and test isolation checks passed.',
        checks: [
          { id: 'v1', name: 'Specification Completeness', status: 'passed', desc: 'All fields validated' },
          { id: 'v2', name: 'Reference Implementation Execution', status: 'passed', desc: 'Builds cleanly' },
          { id: 'v3', name: 'Feature Test Execution', status: 'passed', desc: 'All tests pass on reference' },
          { id: 'v4', name: 'Regression Test Execution', status: 'passed', desc: 'Zero baseline regressions' },
          { id: 'v5', name: 'Acceptance Criteria Coverage', status: 'passed', desc: '100% criteria covered' },
          { id: 'v6', name: 'Test Quality', status: 'passed', desc: 'Hidden tests properly sandboxed' },
          { id: 'v7', name: 'Repository Compatibility', status: 'passed', desc: 'Clean workspace mount' },
          { id: 'v8', name: 'Reproducibility', status: 'passed', desc: 'Deterministic test runs' }
        ]
      }
    };

    setBenchmarks((prev) => [newBench, ...prev]);

    // Update project benchmark count
    setProjects((prev) => prev.map((p) => {
      if (p.id === newBench.projectId) {
        return { ...p, benchmarkCount: p.benchmarkCount + 1, lastActivity: new Date().toISOString() };
      }
      return p;
    }));

    addActivity({
      type: 'benchmark_published',
      title: 'Benchmark Created',
      description: `Created benchmark '${newBench.name}' for repo '${newBench.repositoryName}'.`,
      entityType: 'benchmark',
      entityId: newBench.id,
      badge: 'success'
    });

    addToast({
      title: 'Benchmark Published',
      message: `Benchmark "${newBench.name}" is now ready for agent execution.`,
      type: 'success'
    });

    return newBench;
  };

  // Start Benchmark Run (with interactive live progression simulation!)
  const startBenchmarkRun = (config) => {
    const runId = `run-${Date.now().toString().slice(-4)}`;
    const targetBench = benchmarks.find((b) => b.id === config.benchmarkId) || benchmarks[0];
    const selectedAgentObjs = mockAgents.filter((a) => (config.agentIds || []).includes(a.id));

    const initialAgentExecutions = selectedAgentObjs.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      provider: agent.provider,
      status: 'Running',
      score: null,
      progress: 12,
      currentStage: 'Workspace Preparation',
      duration: 15,
      featurePassRate: null,
      regressionPassRate: null,
      errorCount: 0,
      scores: null,
      submission: null,
      logs: [
        { time: new Date().toLocaleTimeString(), level: 'info', message: `Initializing sandbox environment for ${agent.name}...` },
        { time: new Date().toLocaleTimeString(), level: 'info', message: `Checking out commit ${targetBench.taskSpecification?.startingCommitSha || 'c4a9f21'} on isolated volume.` }
      ]
    }));

    const newRun = {
      id: runId,
      benchmarkId: targetBench.id,
      benchmarkName: targetBench.name,
      repositoryId: targetBench.repositoryId,
      repositoryName: targetBench.repositoryName,
      projectId: targetBench.projectId,
      projectName: targetBench.projectName,
      status: 'Running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      totalDuration: 0,
      runtimeEnvironment: config.runtimeEnvironment || 'Full Stack Node.js 22 LTS',
      resourceLimits: config.resourceLimits || { cpu: '4 vCPUs', memory: '8 GB RAM', timeout: '25 min' },
      participatingAgents: selectedAgentObjs.map((a) => a.id),
      bestPerformingAgent: '--',
      highestScore: '--',
      agentExecutions: initialAgentExecutions,
    };

    setRuns((prev) => [newRun, ...prev]);

    addActivity({
      type: 'run_started',
      title: 'Benchmark Run Dispatched',
      description: `Run #${runId} started with ${selectedAgentObjs.length} agents on '${targetBench.name}'.`,
      entityType: 'run',
      entityId: runId,
      badge: 'info'
    });

    addToast({
      title: 'Run Dispatched',
      message: `Run #${runId} launched with ${selectedAgentObjs.length} agents. Live simulation started.`,
      type: 'info'
    });

    return newRun;
  };

  // Cancel Run
  const cancelRun = (runId) => {
    setRuns((prev) => prev.map((r) => {
      if (r.id === runId && r.status === 'Running') {
        return {
          ...r,
          status: 'Cancelled',
          completedAt: new Date().toISOString(),
          agentExecutions: r.agentExecutions.map((a) => ({
            ...a,
            status: a.status === 'Running' ? 'Cancelled' : a.status,
            logs: [...(a.logs || []), { time: new Date().toLocaleTimeString(), level: 'warn', message: 'Execution cancelled by user.' }]
          }))
        };
      }
      return r;
    }));

    addToast({
      title: 'Run Cancelled',
      message: `Run #${runId} execution was halted.`,
      type: 'warning'
    });
  };

  // Submit human review for evaluation
  const submitHumanReview = (evalId, reviewData) => {
    setEvaluations((prev) => prev.map((ev) => {
      if (ev.id === evalId) {
        return {
          ...ev,
          humanReview: {
            reviewer: reviewData.reviewer || 'Gary Chen (Architect)',
            reviewedAt: new Date().toISOString(),
            status: reviewData.status || 'Approved',
            assessment: reviewData.assessment,
            confidenceScore: reviewData.confidenceScore || 5,
            recommendations: reviewData.recommendations || 'Passed verification.',
          }
        };
      }
      return ev;
    }));

    addToast({
      title: 'Review Saved',
      message: 'Human assessment recorded and archived alongside automated scores.',
      type: 'success'
    });
  };

  // Notification actions
  const markNotificationRead = (id) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  // LLM Provider actions
  const updateProvider = (id, updates) => {
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
    addToast({
      title: 'Provider Updated',
      message: 'LLM Provider credentials saved in local state.',
      type: 'success'
    });
  };

  // Environment actions
  const createEnvironment = (envData) => {
    const newEnv = {
      id: `env-${Date.now()}`,
      ...envData,
      isDefault: false,
    };
    setEnvironments((prev) => [...prev, newEnv]);
    addToast({
      title: 'Environment Profile Saved',
      message: `Profile "${newEnv.name}" added to execution pool.`,
      type: 'success'
    });
    return newEnv;
  };

  const deleteEnvironment = (id) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id));
    addToast({
      title: 'Environment Removed',
      message: 'Execution profile deleted.',
      type: 'info'
    });
  };

  return (
    <AppContext.Provider
      value={{
        projects,
        setProjects,
        selectedProjectId,
        setSelectedProjectId,
        repositories,
        setRepositories,
        benchmarks,
        setBenchmarks,
        runs,
        setRuns,
        evaluations,
        setEvaluations,
        agents: mockAgents,
        leaderboard: mockLeaderboard,
        activities,
        notifications,
        providers,
        environments,
        toasts,
        addToast,
        removeToast,
        globalSearchOpen,
        setGlobalSearchOpen,
        createProject,
        connectRepository,
        reanalyzeRepository,
        createBenchmark,
        startBenchmarkRun,
        cancelRun,
        submitHumanReview,
        markNotificationRead,
        markAllNotificationsRead,
        updateProvider,
        createEnvironment,
        deleteEnvironment
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
