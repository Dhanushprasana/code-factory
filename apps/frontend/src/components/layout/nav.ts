import {
  CircleGauge,
  ClipboardList,
  FolderKanban,
  GitBranch,
  Settings,
  Sparkles,
} from 'lucide-react';

export const nav = [
  { to: '/', label: 'Overview', icon: CircleGauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/tasks/new', label: 'Task generator', icon: Sparkles },
  { to: '/tasks', label: 'Task library', icon: ClipboardList },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/analysis', label: 'Repository Analysis', icon: GitBranch },
];
