import React, { useState } from 'react';

export interface TaskItem {
  id: string;
  title: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

export const INITIAL_TASKS: TaskItem[] = [
  { id: '1', title: 'Update dependencies', priority: 'LOW' },
  { id: '2', title: 'Refactor database', priority: 'MEDIUM' },
  { id: '3', title: 'Fix production outage', priority: 'HIGH' },
];

export function App({ initialTasks = INITIAL_TASKS }: { initialTasks?: TaskItem[] }) {
  const [tasks] = useState<TaskItem[]>(initialTasks);
  const [filter, setFilter] = useState<'ALL' | 'LOW' | 'MEDIUM' | 'HIGH'>('ALL');

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'ALL') return true;
    
    // BUG: Typo in the filter condition: checks 'HIGHEST' instead of 'HIGH'
    if (filter === 'HIGH') {
      return t.priority === ('HIGHEST' as any);
    }
    
    return t.priority === filter;
  });

  return (
    <div style={{ padding: 20 }}>
      <h1>Task Manager</h1>
      <div style={{ marginBottom: 15 }}>
        <button onClick={() => setFilter('ALL')}>All</button>
        <button onClick={() => setFilter('LOW')}>Low</button>
        <button onClick={() => setFilter('MEDIUM')}>Medium</button>
        <button onClick={() => setFilter('HIGH')}>High</button>
      </div>

      <ul data-testid="task-list">
        {filteredTasks.map((task) => (
          <li key={task.id} data-testid={`task-${task.id}`}>
            <span>{task.title}</span> - <strong>{task.priority}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
