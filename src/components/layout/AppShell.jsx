import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastContainer } from '../common/ToastContainer';
import { GlobalSearchModal } from './GlobalSearchModal';
import { cn } from '../../lib/utils';

export const AppShell = () => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans">
      {/* Sidebar */}
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        <Topbar collapsed={collapsed} />

        <main
          className={cn(
            "flex-1 p-6 md:p-8 transition-all duration-300 max-w-7xl w-full mx-auto",
            collapsed ? "md:ml-18" : "md:ml-64"
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* Global Modals & Notifications */}
      <ToastContainer />
      <GlobalSearchModal />
    </div>
  );
};
