import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function formatNumber(num) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="font-mono text-sm" style={{ color: entry.color }}>
          {entry.name}: {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function TokenChart({ data = [], height = 300, title = 'Token Consumption' }) {
  return (
    <div className="card">
      {title && (
        <h3 className="text-sm font-medium text-slate-400 mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            tickFormatter={formatNumber}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="tokens"
            name="Tokens"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#tokenGradient)"
            dot={false}
            activeDot={{
              r: 5,
              fill: '#f59e0b',
              stroke: '#0f172a',
              strokeWidth: 2,
            }}
          />
          {data.length > 0 && data[0].waste !== undefined && (
            <Area
              type="monotone"
              dataKey="waste"
              name="Waste"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              fill="none"
              dot={false}
              activeDot={{
                r: 4,
                fill: '#ef4444',
                stroke: '#0f172a',
                strokeWidth: 2,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
