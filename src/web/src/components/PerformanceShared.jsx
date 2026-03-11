import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export { ScoreGauge, ScoreBar, StatCard, TrendBadge, ScoreSparkline, Pagination } from './SecurityShared.jsx';

/**
 * Hook: fetch performance overview data and trigger analysis.
 */
export function usePerformanceData(days = 7) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/performance/overview?days=${days}&compact=1`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Performance fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  const triggerAnalyze = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/performance/analyze/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Performance analyze error:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return { data, loading, triggerAnalyze, refetch: fetchOverview };
}

export function CostBadge({ amount }) {
  if (amount == null) return <span className="text-slate-500">-</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
      ${typeof amount === 'number' ? amount.toFixed(4) : amount}
    </span>
  );
}

export function ToolBar({ name, count, total }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-300 w-36 truncate font-mono">{name}</span>
      <div className="flex-1 h-2.5 bg-surface-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(pct, 0.5)}%`,
            background: 'linear-gradient(90deg, #f59e0b 0%, #ea580c 100%)',
          }}
        />
      </div>
      <span className="text-xs text-slate-500 w-10 text-right">{pct.toFixed(1)}%</span>
      <span className="text-sm font-mono text-slate-400 w-14 text-right">{count.toLocaleString()}</span>
    </div>
  );
}

export function LoadingSpinner({ text }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-16 text-slate-500">
      <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p>{text || t('status.loading')}</p>
    </div>
  );
}

export function EmptyState({ text }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-16 text-slate-500">
      <p>{text || t('status.noData')}</p>
    </div>
  );
}
