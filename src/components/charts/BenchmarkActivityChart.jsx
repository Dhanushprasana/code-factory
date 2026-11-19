import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export const BenchmarkActivityChart = () => {
  const [range, setRange] = useState('30d');

  const data7d = [
    { name: 'Day 1', benchmarks: 2, runs: 6, completed: 6 },
    { name: 'Day 2', benchmarks: 3, runs: 9, completed: 8 },
    { name: 'Day 3', benchmarks: 1, runs: 5, completed: 5 },
    { name: 'Day 4', benchmarks: 4, runs: 12, completed: 11 },
    { name: 'Day 5', benchmarks: 2, runs: 8, completed: 8 },
    { name: 'Day 6', benchmarks: 5, runs: 15, completed: 14 },
    { name: 'Day 7', benchmarks: 3, runs: 10, completed: 10 },
  ];

  const data30d = [
    { name: 'Week 1', benchmarks: 12, runs: 34, completed: 32 },
    { name: 'Week 2', benchmarks: 16, runs: 42, completed: 40 },
    { name: 'Week 3', benchmarks: 22, runs: 58, completed: 54 },
    { name: 'Week 4', benchmarks: 18, runs: 49, completed: 48 },
  ];

  const data90d = [
    { name: 'Sep', benchmarks: 28, runs: 84, completed: 80 },
    { name: 'Oct', benchmarks: 42, runs: 126, completed: 120 },
    { name: 'Nov', benchmarks: 56, runs: 168, completed: 162 },
  ];

  const currentData = range === '7d' ? data7d : range === '90d' ? data90d : data30d;

  return (
    <div className="rounded-xl bg-[#0f172a] border border-slate-800/80 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-white">Benchmark Activity & Executions</h3>
          <p className="text-xs text-slate-400">Throughput of generated benchmarks vs. completed agent evaluation runs</p>
        </div>

        <div className="flex items-center gap-1 bg-[#141e33] p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
          {['7d', '30d', '90d'].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                range === r
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={currentData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorRuns" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorComp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorBench" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
            <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
              itemStyle={{ color: '#f8fafc' }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
            <Area type="monotone" dataKey="runs" name="Runs Executed" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorRuns)" />
            <Area type="monotone" dataKey="completed" name="Completed Runs" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorComp)" />
            <Area type="monotone" dataKey="benchmarks" name="Benchmarks Generated" stroke="#38bdf8" strokeWidth={2} fillOpacity={1} fill="url(#colorBench)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
