import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';

import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { ProjectsPage } from '../pages/projects/ProjectsPage';
import { ProjectDetailsPage } from '../pages/projects/ProjectDetailsPage';
import { RepositoriesPage } from '../pages/repositories/RepositoriesPage';
import { RepositoryDetailsPage } from '../pages/repositories/RepositoryDetailsPage';
import { BenchmarksPage } from '../pages/benchmarks/BenchmarksPage';
import { CreateBenchmarkWizard } from '../pages/benchmarks/CreateBenchmarkWizard';
import { BenchmarkDetailsPage } from '../pages/benchmarks/BenchmarkDetailsPage';
import { RunsPage } from '../pages/runs/RunsPage';
import { RunDetailsPage } from '../pages/runs/RunDetailsPage';
import { ResultsPage } from '../pages/results/ResultsPage';
import { EvaluationReportPage } from '../pages/results/EvaluationReportPage';
import { LeaderboardPage } from '../pages/leaderboard/LeaderboardPage';
import { SettingsPage } from '../pages/settings/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'projects',
        element: <ProjectsPage />,
      },
      {
        path: 'projects/:id',
        element: <ProjectDetailsPage />,
      },
      {
        path: 'repositories',
        element: <RepositoriesPage />,
      },
      {
        path: 'repositories/:id',
        element: <RepositoryDetailsPage />,
      },
      {
        path: 'benchmarks',
        element: <BenchmarksPage />,
      },
      {
        path: 'benchmarks/create',
        element: <CreateBenchmarkWizard />,
      },
      {
        path: 'benchmarks/:id',
        element: <BenchmarkDetailsPage />,
      },
      {
        path: 'runs',
        element: <RunsPage />,
      },
      {
        path: 'runs/:id',
        element: <RunDetailsPage />,
      },
      {
        path: 'results',
        element: <ResultsPage />,
      },
      {
        path: 'results/:id',
        element: <EvaluationReportPage />,
      },
      {
        path: 'leaderboard',
        element: <LeaderboardPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: 'settings/:subtab',
        element: <SettingsPage />,
      },
      {
        path: '*',
        element: <Navigate to="/dashboard" replace />,
      },
    ],
  },
]);
