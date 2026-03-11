import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  usePerformanceData,
  ScoreGauge,
  ScoreBar,
  StatCard,
  TrendBadge,
  ScoreSparkline,
  LoadingSpinner,
  EmptyState,
} from '../components/PerformanceShared.jsx';

function getPerformanceScoreLabel(t, grade) {
  const labelKey = {
    A: 'overview.scoreLabels.excellent',
    B: 'overview.scoreLabels.good',
    C: 'overview.scoreLabels.fair',
    D: 'overview.scoreLabels.poor',
    F: 'overview.scoreLabels.needsImprovement',
  }[grade];

  return labelKey ? t(labelKey) : grade;
}

export default function PerformanceOverview() {
  const { t } = useTranslation('performance');
  const navigate = useNavigate();
  const { data, loading, triggerAnalyze } = usePerformanceData(7);
  const [trendData, setTrendData] = useState(null);

  useEffect(() => {
    fetch('/api/performance/history?days=30')
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        if (d?.trendData) setTrendData(d.trendData);
      })
      .catch(() => {});
  }, []);

  const score = data?.score;
  const metrics = data?.metrics;
  const trend = score?.trend || trendData;
  const topSessions = useMemo(
    () => (data?.sessionMetrics || []).slice().sort((a, b) => b.cost - a.cost).slice(0, 5),
    [data?.sessionMetrics]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('overview.title')}</h3>
        <button
          onClick={triggerAnalyze}
          disabled={loading}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? t('overview.analyzing') : t('overview.reanalyze')}
        </button>
      </div>

      {loading && !data && <LoadingSpinner text={t('overview.analyzingMsg')} />}

      {!loading && (!data || data.totalEvents === 0) && (
        <EmptyState text={t('overview.noData')} />
      )}

      {data && data.totalEvents > 0 && (
        <>
          {/* Score card */}
          {score && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 p-6 flex items-center gap-8">
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <ScoreGauge
                  score={score.score}
                  grade={score.grade}
                  label={getPerformanceScoreLabel(t, score.grade)}
                />
                {trend && <TrendBadge direction={trend.direction} delta={trend.delta} />}
              </div>
              <div className="flex-1 space-y-3">
                {score.breakdown && (
                  <>
                    <ScoreBar label={t('overview.cacheEfficiency')} value={score.breakdown.cacheEfficiency} max={25} />
                    <ScoreBar label={t('overview.tokenEfficiency')} value={score.breakdown.tokenEfficiency} max={25} />
                    <ScoreBar label={t('overview.toolEfficiency')} value={score.breakdown.toolEfficiency} max={20} />
                    <ScoreBar label={t('overview.sessionHygiene')} value={score.breakdown.sessionHygiene} max={15} />
                    <ScoreBar label={t('overview.costEfficiency')} value={score.breakdown.costEfficiency} max={15} />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Stat cards */}
          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label={t('overview.estimatedCost')}
                value={metrics.cost ? `$${metrics.cost.totalCost.toFixed(2)}` : '-'}
              />
              <StatCard
                label={t('overview.cacheHitRate')}
                value={`${(metrics.cacheEfficiency * 100).toFixed(1)}%`}
              />
              <StatCard
                label={t('overview.avgResponseLatency')}
                value={metrics.avgLatency != null ? `${metrics.avgLatency.toFixed(1)}s` : '-'}
              />
              <StatCard
                label={t('overview.totalToolCalls')}
                value={metrics.totalToolCalls}
              />
            </div>
          )}

          {/* Cost disclaimer */}
          {metrics?.cost && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400/80">
              <span className="shrink-0 mt-0.5">ⓘ</span>
              <span>{t('overview.costDisclaimer')}</span>
            </div>
          )}

          {/* Additional stats */}
          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label={t('overview.totalEvents')} value={metrics.totalEvents} />
              <StatCard label={t('overview.totalSessions')} value={metrics.totalSessions} />
              <StatCard
                label={t('overview.toolSuccessRate')}
                value={`${(metrics.toolSuccessRate * 100).toFixed(1)}%`}
                alert={metrics.toolSuccessRate < 0.9}
                alertColor="orange"
              />
              <StatCard
                label={t('overview.tokenEfficiency')}
                value={`${(metrics.tokenEfficiency * 100).toFixed(1)}%`}
              />
            </div>
          )}

          {/* Trend sparkline */}
          {trend && trend.history && trend.history.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-slate-300">{t('overview.scoreTrend')}</h4>
                <span className="text-xs text-slate-500">{t('overview.last30Days')}</span>
              </div>
              <ScoreSparkline data={trend.history} height={80} />
            </div>
          )}

          {/* Top sessions */}
          {topSessions.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700">
                <h4 className="text-sm font-medium text-slate-300">{t('overview.sessionPerformanceByCost')}</h4>
              </div>
              <div className="divide-y divide-surface-700">
                {topSessions.map((sm) => (
                    <div key={sm.sessionId} className="px-5 py-3 flex items-center gap-4 cursor-pointer hover:bg-surface-700 transition-colors" onClick={() => navigate(`/sessions?id=${sm.sessionId}`)}>
                      <div className="truncate w-48 flex flex-col">
                        {sm.title && <span className="text-sm text-slate-200 truncate">{sm.title}</span>}
                        <span className={`font-mono text-slate-500 truncate ${sm.title ? 'text-[10px]' : 'text-sm text-slate-300'}`}>{sm.sessionId.slice(0, 16)}...</span>
                      </div>
                      <span className="text-xs text-slate-500">{sm.eventCount} {t('overview.events')}</span>
                      <span className="text-xs text-emerald-400 font-mono">${sm.cost.toFixed(4)}</span>
                      <span className="text-xs text-slate-500">
                        {sm.cacheEfficiency != null ? `${t('overview.cache')} ${(sm.cacheEfficiency * 100).toFixed(0)}%` : ''}
                      </span>
                      <span className="ml-auto text-xs text-slate-600">
                        {sm.models.join(', ')}
                      </span>
                    </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
