import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';

export const AgentPerformanceChart = () => {
  const [metric, setMetric] = useState('score'); // 'score' | 'passRate' | 'time'

  const data = [
    { name: 'Antigravity', score: 92.8, passRate: 95.8, time: 7.3, color: '#6366f1' },
    { name: 'Codex', score: 90.4, passRate: 94.2, time: 8.5, color: '#10a37f' },
    { name: 'Claude Code', score: 88.6, passRate: 91.5, time: 9.6, color: '#d97706' },
    { name: 'Gemini CLI', score: 85.2, passRate: 87.0, time: 6.5, color: '#3b82f6' },
  ];

  const getYAxisProps = () => {
    if (metric === 'time') {
      return { domain: [0, 12], unit: ' min' };
    }
    return { domain: [60, 100], unit: '%' };
  };

  const { domain, unit } = getYAxisProps();

  return (
    <div className="rounded-xl bg-[#0f172a] border border-slate-800/80 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">Agent Benchmark Comparison</h3>
          <p className="text-xs text-slate-400">Head-to-head performance across standard benchmark suites</p>
        </div>

        <div className="flex items-center gap-1 bg-[#141e33] p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          {[
            { key: 'score', label: 'Avg Score' },
            { key: 'passRate', label: 'Test Pass %' },
            { key: 'time', label: 'Exec Time' },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === m.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
            <YAxis domain={domain} stroke="#64748b" fontSize={11} tickLine={false} unit={unit} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
              itemStyle={{ color: '#f8fafc' }}
              formatter={(value) => [
                metric === 'time' ? `${value} min` : `${value}%`,
                metric === 'time' ? 'Avg Execution Time' : metric === 'passRate' ? 'Test Pass Rate' : 'Average Benchmark Score'
              ]}
            />
            <Bar dataKey={metric} radius={[6, 6, 0, 0]} maxBarSize={48}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
