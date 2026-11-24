import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { nav } from './nav';
import { NewProjectModal } from '../modals/NewProjectModal';
import { Overview } from '../../pages/Overview';
import { Projects } from '../../pages/Projects';
import { TaskGeneratorPage } from '../../pages/TaskGeneratorPage';
import { TaskLibraryPage } from '../../pages/TaskLibraryPage';
import { SettingsPage } from '../../pages/SettingsPage';
import { AnalysisPage } from '../../pages/AnalysisPage';

export function Shell() {
  const [modal, setModal] = useState(false);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <strong>ForgeBench</strong>
            <span>Benchmark Studio</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <span>Project workspace</span>
          <button className="primary-button" onClick={() => setModal(true)}>
            <Plus size={17} /> New project
          </button>
        </header>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/projects" element={<Projects onNewProject={() => setModal(true)} />} />
          <Route path="/tasks/new" element={<TaskGeneratorPage />} />
          <Route path="/tasks/:taskId" element={<TaskLibraryPage />} />
          <Route path="/tasks" element={<TaskLibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/analysis" element={<AnalysisPage />} />
          <Route path="/analysis/:analysisId" element={<AnalysisPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {modal && (
        <NewProjectModal
          onClose={() => setModal(false)}
          onCreated={() => window.dispatchEvent(new Event('forgebench-projects-updated'))}
        />
      )}
    </div>
  );
}
