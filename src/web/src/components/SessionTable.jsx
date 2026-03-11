import React, { useState, useMemo } from 'react';

function formatTokens(n) {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const COLUMNS = [
  { key: 'timestamp', label: 'Time', sortable: true, render: (v) => formatTime(v) },
  { key: 'agent', label: 'Agent', sortable: true },
  { key: 'project', label: 'Project', sortable: true },
  { key: 'turns', label: 'Turns', sortable: true, mono: true },
  { key: 'totalTokens', label: 'Tokens', sortable: true, mono: true, render: (v) => formatTokens(v) },
  { key: 'rulesHit', label: 'Rules Hit', sortable: true, mono: true },
];

export default function SessionTable({ sessions = [], onSelect, selectedId }) {
  const [sortKey, setSortKey] = useState('timestamp');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [sessions, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const isAbnormal = (session) => {
    return (session.rulesHit || 0) > 3 || (session.totalTokens || 0) > 500_000;
  };

  if (sessions.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-slate-500">No sessions found</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  className={`px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider ${
                    col.sortable ? 'cursor-pointer hover:text-slate-300 select-none' : ''
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-primary-500">
                        {sortDir === 'asc' ? '\u25b2' : '\u25bc'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700/50">
            {sorted.map((session) => (
              <tr
                key={session.sessionId}
                onClick={() => onSelect?.(session)}
                className={`cursor-pointer transition-colors ${
                  selectedId === session.sessionId
                    ? 'bg-primary-500/10'
                    : isAbnormal(session)
                    ? 'bg-red-500/5 hover:bg-red-500/10'
                    : 'hover:bg-surface-800'
                }`}
              >
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 whitespace-nowrap ${
                      col.mono ? 'font-mono text-primary-400' : 'text-slate-300'
                    }`}
                  >
                    {col.render ? col.render(session[col.key]) : session[col.key] ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
