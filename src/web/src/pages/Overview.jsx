import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useFetch } from '../hooks/useApi.js';
import { getTokenRuleGuideEntry } from './tokenRuleGuides.js';

// --- helpers ---

function formatNumber(n) {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getGradeInfo(score, t) {
  if (score >= 90) return { letter: 'A', label: t('grade.excellent'), color: '#22c55e' };
  if (score >= 75) return { letter: 'B', label: t('grade.good'), color: '#22c55e' };
  if (score >= 60) return { letter: 'C', label: t('grade.fair'), color: '#f59e0b' };
  if (score >= 40) return { letter: 'D', label: t('grade.poor'), color: '#f97316' };
  return { letter: 'F', label: t('grade.needsImprovement'), color: '#ef4444' };
}

function pctChange(cur, prev) {
  if (!prev || !cur) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

const MODEL_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#06b6d4'];

// --- sub-components ---

function ScoreGauge({ score, grade }) {
  const size = 96;
  const center = size / 2;
  const radius = 40;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={center} cy={center} r={radius} fill="none" stroke="#334155" strokeWidth={strokeWidth} />
          <circle
            cx={center} cy={center} r={radius} fill="none"
            stroke={grade.color} strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
            style={{ filter: `drop-shadow(0 0 6px ${grade.color}40)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono font-bold text-[28px] leading-none" style={{ color: grade.color }}>
            {score}
          </span>
        </div>
      </div>
      <span className="text-[13px] font-medium" style={{ color: grade.color }}>
        {grade.letter} · {grade.label}
      </span>
    </div>
  );
}

function TrendBadge({ delta }) {
  const { t } = useTranslation('common');
  if (delta == null) return null;
  const positive = delta >= 0;
  const color = positive ? '#22c55e' : '#ef4444';
  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-xs font-semibold" style={{ color }}>{positive ? '↑' : '↓'}</span>
      <span className="text-xs font-semibold" style={{ color }}>{positive ? '+' : ''}{delta}</span>
      <span className="text-xs text-slate-500">{t('trend.comparedToPreviousAnalysis')}</span>
    </div>
  );
}

function BreakdownBar({ label, value, max, color }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-[130px] shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-slate-400 font-mono w-12 text-right shrink-0">{value}/{max}</span>
    </div>
  );
}

function StatCard({ label, value, trend, alert }) {
  return (
    <div className="card flex-1 min-w-0">
      <p className="text-[13px] text-slate-400">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className={`font-bold text-2xl ${alert ? 'text-red-400' : 'text-slate-100'}`}>
          {value}
        </span>
        {trend != null && (
          <span className={`text-[11px] font-semibold ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
    </div>
  );
}

function TrendChart({ data }) {
  const { t } = useTranslation('overview');
  if (!data || data.length === 0) return null;

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-slate-200">{t('chart.tokenTrend')}</h4>
        <span className="text-xs text-slate-500">{t('chart.last7Days')}</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <defs>
            <linearGradient id="overviewGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date" axisLine={false} tickLine={false}
            tick={{ fill: '#64748b', fontSize: 10 }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 shadow-xl">
                  <p className="text-slate-400 text-xs mb-1">{label}</p>
                  <p className="font-mono text-sm text-primary-400">
                    {formatNumber(payload[0].value)} {t('chart.tokens')}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone" dataKey="tokens" stroke="#f59e0b" strokeWidth={2}
            fill="url(#overviewGrad)" dot={false}
            activeDot={{ r: 4, fill: '#f59e0b', stroke: '#0f172a', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ModelDistribution({ sessions }) {
  const { t } = useTranslation('overview');
  const modelCounts = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const counts = {};
    for (const s of sessions) {
      for (const m of (s.models || [])) {
        counts[m] = (counts[m] || 0) + (s.totalTokens || 0);
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, tokens]) => ({
        name,
        value: total > 0 ? Math.round((tokens / total) * 100) : 0,
      }));
  }, [sessions]);

  if (modelCounts.length === 0) {
    return (
      <div className="card h-full">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">{t('chart.modelDistribution')}</h3>
        <p className="text-xs text-slate-600">{t('empty.noData')}</p>
      </div>
    );
  }

  return (
    <div className="card h-full">
      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-1">{t('chart.modelDistribution')}</h3>
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie
                data={modelCounts} cx="50%" cy="50%"
                innerRadius={28} outerRadius={50}
                dataKey="value" stroke="none"
              >
                {modelCounts.map((_, i) => (
                  <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 shadow-xl">
                      <p className="text-sm text-slate-300">
                        {payload[0].name}: <span className="font-mono text-primary-400">{payload[0].value}%</span>
                      </p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5">
          {modelCounts.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
              />
              <span className="text-slate-400 truncate">{m.name}</span>
              <span className="font-mono text-slate-500 ml-auto">{m.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveSessionCard({ data }) {
  const { t } = useTranslation('overview');
  const navigate = useNavigate();

  if (!data) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
          {t('live.noActiveSessions')}
        </div>
      </div>
    );
  }

  const title = data.project || data.agent;
  const shortId = data.sessionId ? data.sessionId.slice(0, 8) + '…' : null;

  return (
    <div
      className="card !border-primary-500/20 cursor-pointer hover:!border-primary-500/40 transition-colors"
      onClick={() => navigate(data.sessionId ? `/sessions?id=${encodeURIComponent(data.sessionId)}` : '/sessions')}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
        <span className="text-xs font-medium text-slate-300">{t('live.live')}</span>
        <span className="text-[10px] text-slate-500 font-mono ml-auto">{data.agent}</span>
      </div>
      {title && (
        <p className="text-[11px] text-slate-400 truncate mb-1">{title}</p>
      )}
      {shortId && (
        <p className="text-[10px] text-slate-600 font-mono mb-3">{shortId}</p>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="font-mono text-sm font-bold text-primary-400">{data.turns || 0}</p>
          <p className="text-[10px] text-slate-500">{t('live.turns')}</p>
        </div>
        <div>
          <p className="font-mono text-sm font-bold text-primary-400">{formatNumber(data.totalTokens)}</p>
          <p className="text-[10px] text-slate-500">{t('live.tokens')}</p>
        </div>
        <div>
          <p className="font-mono text-sm font-bold text-red-400">{data.rulesHit || 0}</p>
          <p className="text-[10px] text-slate-500">{t('live.rules')}</p>
        </div>
      </div>
    </div>
  );
}

function RecentSessionsList({ sessions }) {
  const { t } = useTranslation('overview');
  const navigate = useNavigate();

  if (!sessions || sessions.length === 0) {
    return <p className="text-xs text-slate-600">{t('empty.noSessionRecords')}</p>;
  }

  return (
    <div className="space-y-1.5">
      {sessions.slice(0, 4).map((s) => {
        const title = s.title || s.projectName || (s.sessionId ? s.sessionId.slice(0, 16) + '…' : 'unknown');
        return (
          <div
            key={s.sessionId || title}
            className="flex items-center gap-2 bg-surface-900 rounded-md px-2 py-1.5 text-[11px] border border-surface-700 cursor-pointer hover:border-slate-500 transition-colors"
            onClick={() => navigate(s.sessionId ? `/sessions?id=${encodeURIComponent(s.sessionId)}` : '/sessions')}
          >
            <div className="min-w-0 flex-1">
              <p className="text-slate-300 truncate">{title}</p>
              <p className="text-[10px] text-slate-600 font-mono">{s.agent || 'unknown'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-primary-400">{formatNumber(s.totalTokens)}</p>
              <p className="text-slate-600">{s.eventCount || 0}t</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WASTE_SEVERITY = {
  high: { border: 'border-red-500/20', bg: 'bg-red-500/5', textClass: 'text-red-400' },
  medium: { border: 'border-yellow-500/20', bg: 'bg-yellow-500/5', textClass: 'text-amber-400' },
  low: { border: 'border-blue-500/20', bg: 'bg-blue-500/5', textClass: 'text-blue-400' },
};

function WastePatternsList({ patterns }) {
  const { t } = useTranslation('overview');
  const navigate = useNavigate();

  if (!patterns || patterns.length === 0) {
    return <p className="text-xs text-slate-600">{t('empty.noWastePatterns')}</p>;
  }

  return (
    <div className="space-y-1.5">
      {patterns.slice(0, 3).map((p, i) => {
        const style = WASTE_SEVERITY[p.severity] || WASTE_SEVERITY.low;
        return (
          <button
            key={p.ruleId || i}
            type="button"
            onClick={() => navigate(`/diagnostics?rule=${encodeURIComponent(p.ruleId)}`)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors hover:border-primary-500/40 hover:bg-primary-500/5 ${style.border} ${style.bg}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-slate-200">{p.name}</p>
                  <span className="rounded-full border border-surface-600 bg-surface-900/70 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                    {p.ruleId}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">{p.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                  <span>{t('wastePatterns.occurrences', { count: p.occurrences || 0 })}</span>
                  <span>{t('wastePatterns.viewDiagnosis')}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-mono text-[11px] ${style.textClass}`}>~{formatNumber(p.estimatedWaste)}</p>
                <p className="mt-1 text-[10px] text-slate-500">{t('wastePatterns.recoverable')}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// --- main component ---

export default function Overview() {
  const { t } = useTranslation('overview');
  const { i18n } = useTranslation();

  // --- breakdown bar config ---
  const BREAKDOWN_CONFIG = useMemo(() => [
    { key: 'wasteRatio', label: t('breakdown.wasteControl'), color: '#22c55e', max: 40 },
    { key: 'cacheEfficiency', label: t('breakdown.cacheEfficiency'), color: '#3b82f6', max: 20 },
    { key: 'sessionHygiene', label: t('breakdown.sessionQuality'), color: '#f59e0b', max: 15 },
    { key: 'modelFit', label: t('breakdown.modelFit'), color: '#a855f7', max: 15 },
    { key: 'toolEfficiency', label: t('breakdown.toolEfficiency'), color: '#06b6d4', max: 10 },
  ], [t]);

  // Stats API is used for time-series totals only.
  const { data: statsData, loading: statsLoading, refetch: refetchStats } = useFetch('/api/stats?days=7&compact=1');
  const { data: prevStatsData } = useFetch('/api/stats?days=14&compact=1');
  // Analysis API returns the latest analysis batch and diagnostics summary.
  const { data: analysisData, refetch: refetchAnalysis } = useFetch('/api/analysis?days=7');
  // Sessions for recent list + model distribution. Keep Overview aligned with the Sessions page data source.
  const { data: recentSessions, refetch: refetchRecentSessions } = useFetch('/api/sessions?limit=30');
  const { data: currentSessionData, refetch: refetchCurrentSession } = useFetch('/api/plugins/current-session');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchStats(),
        refetchAnalysis(),
        refetchRecentSessions(),
        refetchCurrentSession(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchStats, refetchAnalysis, refetchRecentSessions, refetchCurrentSession]);

  // Derive totals from the stats time series.
  const daily = statsData?.daily || [];
  const totalSessions = daily.reduce((s, d) => s + (d.sessionCount || 0), 0);
  const totalTokens = daily.reduce((s, d) => s + (d.totalInput || 0) + (d.totalOutput || 0), 0);

  // Previous period for trend
  const prevDaily = prevStatsData?.daily || [];
  const prevTotalSessions = prevDaily.reduce((s, d) => s + (d.sessionCount || 0), 0) - totalSessions;
  const prevTotalTokens = prevDaily.reduce((s, d) => s + (d.totalInput || 0) + (d.totalOutput || 0), 0) - totalTokens;
  const sessionsTrend = pctChange(totalSessions, prevTotalSessions);
  const tokensTrend = pctChange(totalTokens, prevTotalTokens);

  const healthScore = analysisData?.healthScore || null;
  const score = healthScore?.score ?? 0;
  const grade = getGradeInfo(score, t);
  const breakdown = healthScore?.breakdown;
  const scoreTrend = healthScore?.previousScore != null ? score - healthScore.previousScore : null;

  // Daily chart data
  const trendData = daily.map(d => ({
    date: d.date?.slice(5) || d.date,
    tokens: (d.totalInput || 0) + (d.totalOutput || 0),
  }));

  // Waste patterns from analysis summary
  const wastePatterns = (analysisData?.summary || [])
    .filter(r => r.estimatedWastedTokens > 0)
    .sort((a, b) => (b.estimatedWastedTokens || 0) - (a.estimatedWastedTokens || 0))
    .slice(0, 3)
    .map(r => {
      const ruleId = r.rule || r.ruleId;
      const guide = getTokenRuleGuideEntry(i18n.resolvedLanguage || i18n.language, { id: ruleId, ruleId });
      return {
        name: guide?.title || ruleId,
        ruleId,
        severity: r.severity || 'low',
        estimatedWaste: r.estimatedWastedTokens || 0,
        summary: guide?.summary || r.detail?.description || ruleId,
        occurrences: r.occurrences || 0,
      };
    });

  const totalWaste = analysisData?.totalWastedTokens || 0;

  const sessions = useMemo(
    () => (recentSessions?.sessions || []).slice().sort((a, b) => (b.endTime || 0) - (a.endTime || 0)),
    [recentSessions?.sessions]
  );
  const isLoading = statsLoading && !statsData;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('header.title')}</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {refreshing ? t('header.analyzing') : t('header.refreshAnalysis')}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-16 text-slate-500">
          <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p>{t('header.loading')}</p>
        </div>
      )}

      {!isLoading && (
        <>
          {/* Score Card: Gauge + Breakdown Bars */}
          <div className="card flex items-center gap-8">
            <div className="shrink-0 flex flex-col items-center">
              <ScoreGauge score={score} grade={grade} />
              <TrendBadge delta={scoreTrend} />
            </div>
            <div className="flex-1 space-y-2.5">
              {breakdown ? BREAKDOWN_CONFIG.map(cfg => (
                <BreakdownBar
                  key={cfg.key}
                  label={cfg.label}
                  value={breakdown[cfg.key] ?? 0}
                  max={cfg.max}
                  color={cfg.color}
                />
              )) : (
                <p className="text-sm text-slate-500">{t('empty.noScoreData')}</p>
              )}
            </div>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label={t('stats.sessions')} value={totalSessions} trend={sessionsTrend} />
            <StatCard label={t('stats.tokenUsage')} value={formatNumber(totalTokens)} trend={tokensTrend} />
            <StatCard label={t('stats.avgScore')} value={score} />
            <StatCard label={t('stats.estimatedWaste')} value={formatNumber(totalWaste)} alert={totalWaste > 0} />
          </div>

          {/* Token Trend + Model Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <TrendChart data={trendData} />
            </div>
            <div className="lg:col-span-4">
              <ModelDistribution sessions={sessions} />
            </div>
          </div>

          {/* Bottom 3-column: Live Session + Recent Sessions + Waste Patterns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-slate-400">{t('section.currentSession')}</h3>
              <LiveSessionCard data={currentSessionData?.session || null} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-slate-400">{t('section.recentSessions')}</h3>
              <RecentSessionsList sessions={sessions} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-slate-400">{t('section.topWastePatterns')}</h3>
              <WastePatternsList patterns={wastePatterns} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
