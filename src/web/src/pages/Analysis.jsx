import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import MessageList from '../components/MessageList.jsx';
import Pagination from '../components/Pagination.jsx';
import { useFetch } from '../hooks/useApi.js';
import { getTokenRuleGuideEntry } from './tokenRuleGuides.js';
import { normalizeReportToRecommendations } from '../lib/ai-report.js';

function formatTokens(n) {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function buildActionQueue(rules, language) {
  const severityOrder = { high: 0, medium: 1, low: 2, critical: -1 };

  return [...rules]
    .map((rule) => {
      const guide = getTokenRuleGuideEntry(language, rule);
      if (!guide) return null;
      return {
        id: rule.id || rule.ruleId,
        title: guide.title,
        description: guide.summary,
        priority: rule.severity || 'low',
        impact: getRuleEstimatedWaste(rule),
        hits: rule.occurrences || 0,
        steps: guide.actions || [],
        category: guide.categoryLabel,
        technicalRule: rule.id || rule.ruleId,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const severityDiff = (severityOrder[a.priority] ?? 9) - (severityOrder[b.priority] ?? 9);
      if (severityDiff !== 0) return severityDiff;
      const impactDiff = (b.impact || 0) - (a.impact || 0);
      if (impactDiff !== 0) return impactDiff;
      return (b.hits || 0) - (a.hits || 0);
    });
}

function getRuleEstimatedWaste(rule) {
  if (typeof rule?.estimatedWaste === 'number' && rule.estimatedWaste > 0) {
    return rule.estimatedWaste;
  }

  if (typeof rule?.estimatedWastedTokens === 'number' && rule.estimatedWastedTokens > 0) {
    return rule.estimatedWastedTokens;
  }

  if (Array.isArray(rule?.sessions) && rule.sessions.length > 0) {
    const sessionWaste = rule.sessions.reduce((sum, session) => {
      const waste = Number(session?.waste ?? 0);
      return sum + (Number.isFinite(waste) ? waste : 0);
    }, 0);
    if (sessionWaste > 0) {
      return sessionWaste;
    }
  }

  return 0;
}

function BarTooltip({ active, payload, label }) {
  const { t } = useTranslation('analysis');
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs text-slate-400">{t('turn')} {label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="font-mono text-sm" style={{ color: entry.color }}>
          {entry.name}: {formatTokens(entry.value)}
        </p>
      ))}
    </div>
  );
}

function SessionDrillDown({ session, onClose }) {
  const { t } = useTranslation('analysis');
  const navigate = useNavigate();
  const [showMessages, setShowMessages] = useState(false);
  const turnData = session.turns_detail?.map((item, i) => ({
    turn: i + 1,
    tokens: (item.inputTokens || 0) + (item.outputTokens || 0),
    triggered: item.triggered || false,
  })) ?? [];

  return (
    <div className="space-y-4 rounded-2xl border border-primary-500/20 bg-surface-900/60 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-200">
          {session.title || t('session')} <span className="font-mono text-primary-400">{session.sessionId}</span>
        </h4>
        <button onClick={onClose} className="text-slate-500 transition-colors hover:text-slate-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {turnData.length > 0 ? (
        <div>
          <h5 className="mb-2 text-xs uppercase tracking-wider text-slate-500">{t('tokenUsagePerTurn')}</h5>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={turnData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="turn" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={formatTokens} width={45} />
              <Tooltip content={<BarTooltip />} />
              <Bar dataKey="tokens" name="Tokens" radius={[2, 2, 0, 0]}>
                {turnData.map((entry, i) => (
                  <Cell key={i} fill={entry.triggered ? '#ef4444' : '#f59e0b'} fillOpacity={entry.triggered ? 0.9 : 0.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{t('noTurnData')}</p>
      )}

      <div className="flex items-center gap-4">
        <button onClick={() => setShowMessages((v) => !v)} className="text-xs text-primary-500 transition-colors hover:text-primary-400">
          {showMessages ? t('hideMessages') : t('viewMessages')}
        </button>
        <button onClick={() => navigate(`/sessions?id=${session.sessionId}`)} className="text-xs text-primary-500 transition-colors hover:text-primary-400">
          {t('viewFullTimeline')}
        </button>
      </div>

      {showMessages ? <MessageList sessionId={session.sessionId} /> : null}
    </div>
  );
}

function SummaryCard({ label, value, hint, accent = 'text-slate-100' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-surface-700 bg-surface-800/80 p-4">
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 break-words text-sm text-slate-300">{label}</div>
      <div className="mt-1 break-words text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function StreamingStatus({ status, error }) {
  const { t } = useTranslation('optimize');
  if (status === 'idle') return null;

  const statusConfig = {
    connecting: { text: t('status.connecting'), color: 'text-yellow-400', animate: true },
    streaming: { text: t('status.analyzing'), color: 'text-primary-400', animate: true },
    complete: { text: t('status.complete'), color: 'text-green-400', animate: false },
    error: { text: t('status.failed'), color: 'text-red-400', animate: false },
  };
  const cfg = statusConfig[status] || statusConfig.connecting;

  // Map known error codes to i18n keys
  const errorText = status === 'error' && error?.code
    ? t(`status.error_${error.code}`, { defaultValue: error.message || cfg.text })
    : null;

  return (
    <div className={`flex items-center gap-2 text-sm ${cfg.color}`}>
      {cfg.animate ? (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : null}
      <span>{errorText || cfg.text}</span>
    </div>
  );
}

function FilterChip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-primary-500/30 bg-primary-500/15 text-primary-300'
          : 'border-surface-700 bg-surface-800 text-slate-400 hover:border-surface-600 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function QueueItem({ issue, selected, onSelect, t }) {
  const selectedClass = selected
    ? 'border-primary-500/30 bg-primary-500/10 shadow-[0_8px_24px_rgba(37,99,235,0.12)]'
    : 'border-surface-700 bg-surface-800/70 hover:border-surface-600 hover:bg-surface-800';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left transition-all ${selectedClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge-${issue.priority}`}>{issue.priority}</span>
            <span className="inline-flex items-center rounded-full border border-surface-600 bg-surface-900/80 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {issue.category}
            </span>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-100">{issue.title}</h3>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{issue.description}</p>
        </div>

        <div className="grid shrink-0 gap-2 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t('hits')}</div>
            <div className="font-mono text-sm text-slate-100">{issue.hits}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t('potentialRecovery')}</div>
            <div className="font-mono text-sm text-amber-300">{formatTokens(issue.impact)}</div>
          </div>
        </div>
      </div>
    </button>
  );
}

function EmptyPanel({ title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-surface-700 bg-surface-900/30 p-8 text-center">
      <p className="text-sm text-slate-300">{title}</p>
      <p className="mt-2 text-xs text-slate-500">{description}</p>
    </div>
  );
}

export default function Analysis() {
  const { t: ta, i18n } = useTranslation('analysis');
  const { t: to } = useTranslation('optimize');
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: summaryData, loading } = useFetch('/api/analysis/summary');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [streamStatus, setStreamStatus] = useState('idle');
  const [streamError, setStreamError] = useState(null);
  const [streamText, setStreamText] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('evidence');
  const [sessionPage, setSessionPage] = useState(1);
  const SESSION_PAGE_SIZE = 10;
  const eventSourceRef = useRef(null);
  const drillDownRef = useRef(null);
  const userClickedSessionRef = useRef(false);

  const allRules = summaryData?.rules ?? [];
  const batch = summaryData?.batch ?? null;

  // Extract unique agents from all sessions across rules
  const agents = useMemo(() => {
    const agentMap = {};
    for (const rule of allRules) {
      for (const s of rule.sessions || []) {
        const name = s.agent || null;
        if (!name) continue;
        if (!agentMap[name]) agentMap[name] = { agent: name, occurrences: 0, sessions: new Set(), waste: 0 };
        agentMap[name].occurrences += 1;
        agentMap[name].sessions.add(s.sessionId);
        agentMap[name].waste += s.waste ?? 0;
      }
    }
    return Object.values(agentMap).map((a) => ({ ...a, sessionCount: a.sessions.size, sessions: undefined }));
  }, [allRules]);

  // Filter rules by selected agent
  const rules = useMemo(() => {
    if (!selectedAgent) return allRules;
    return allRules.map((rule) => {
      const filtered = (rule.sessions || []).filter((s) => s.agent === selectedAgent);
      if (filtered.length === 0) return null;
      return { ...rule, sessions: filtered, occurrences: filtered.length, estimatedWaste: getRuleEstimatedWaste({ ...rule, sessions: filtered }) };
    }).filter(Boolean);
  }, [allRules, selectedAgent]);

  const totalOccurrences = rules.reduce((sum, rule) => sum + (rule.occurrences || 0), 0);
  const totalWaste = !selectedAgent ? (batch?.totalWasted ?? rules.reduce((sum, rule) => sum + (rule.estimatedWaste ?? 0), 0)) : rules.reduce((sum, rule) => sum + (rule.estimatedWaste ?? 0), 0);
  const sessionCount = useMemo(() => new Set(rules.flatMap((rule) => (rule.sessions || []).map((session) => session.sessionId))).size, [rules]);
  const hasAnalysisData = totalOccurrences > 0 || allRules.reduce((sum, rule) => sum + (rule.occurrences || 0), 0) > 0;
  const actionQueue = useMemo(() => buildActionQueue(rules, i18n.resolvedLanguage || i18n.language), [rules, i18n.language, i18n.resolvedLanguage]);

  // Reset issue selection when agent changes
  useEffect(() => {
    setSelectedIssueId(null);
    setActiveFilter('all');
  }, [selectedAgent]);

  const filteredQueue = useMemo(() => (
    activeFilter === 'all'
      ? actionQueue
      : actionQueue.filter((issue) => issue.priority === activeFilter)
  ), [actionQueue, activeFilter]);

  useEffect(() => {
    if (!filteredQueue.length) {
      setSelectedIssueId(null);
      return;
    }
    if (!filteredQueue.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(filteredQueue[0].id);
    }
  }, [filteredQueue, selectedIssueId]);

  const selectedIssue = filteredQueue.find((issue) => issue.id === selectedIssueId) || actionQueue.find((issue) => issue.id === selectedIssueId) || null;
  const selectedRule = rules.find((rule) => (rule.id || rule.ruleId) === selectedIssue?.id) || null;
  const selectedSessions = selectedRule?.sessions || [];
  const selectedSession = selectedSessions.find((session) => session.sessionId === selectedSessionId) || null;

  useEffect(() => {
    const requestedRule = searchParams.get('rule');
    if (!requestedRule || !actionQueue.length) return;

    const match = actionQueue.find((issue) => issue.id === requestedRule);
    if (!match) return;

    setSelectedIssueId(match.id);
    setActiveTab('evidence');
  }, [actionQueue, searchParams]);

  useEffect(() => {
    if (!selectedIssue?.id) return;

    const currentRule = searchParams.get('rule');
    if (currentRule === selectedIssue.id) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('rule', selectedIssue.id);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedIssue?.id, setSearchParams]);

  useEffect(() => {
    setSessionPage(1);
    if (!selectedSessions.length) {
      setSelectedSessionId(null);
      return;
    }
    setSelectedSessionId((current) => (
      selectedSessions.some((session) => session.sessionId === current)
        ? current
        : selectedSessions[0].sessionId
    ));
  }, [selectedSessions]);

  useEffect(() => {
    if (selectedSessionId && drillDownRef.current && userClickedSessionRef.current) {
      drillDownRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      userClickedSessionRef.current = false;
    }
  }, [selectedSessionId]);

  useEffect(() => () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/analyze/trigger', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      setAnalyzeError(err.message || ta('analysisFailed'));
    } finally {
      setAnalyzing(false);
    }
  };

  const startStrategyAnalysis = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setRecommendations([]);
    setStreamStatus('connecting');
    setStreamError(null);
    setStreamText('');

    const es = new EventSource('/api/analyze/ai/stream');
    eventSourceRef.current = es;

    es.onopen = () => {
      setStreamStatus('streaming');
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'done') {
          setRecommendations(normalizeReportToRecommendations(data.report, to));
          setStreamStatus('complete');
          setActiveTab('strategy');
          es.close();
          eventSourceRef.current = null;
        } else if (data.type === 'chunk') {
          setStreamText((prev) => prev + (data.text || ''));
          setActiveTab('strategy');
        } else if (data.type === 'error') {
          setStreamStatus('error');
          setStreamError({ code: data.code, message: data.message });
          es.close();
          eventSourceRef.current = null;
        }
      } catch {
        // ignore malformed chunks
      }
    };

    es.onerror = () => {
      setStreamStatus('error');
      setStreamError({ code: 'CONNECTION_ERROR', message: null });
      es.close();
      eventSourceRef.current = null;
    };
  }, [to]);

  return (
    <div className="min-w-0 space-y-6">
      {/* Agent filter cards */}
      {agents.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedAgent(null)}
            className={`flex-shrink-0 bg-surface-800 rounded-xl border px-4 py-3 text-left transition-colors relative overflow-hidden ${
              selectedAgent === null
                ? 'border-amber-500/60'
                : 'border-surface-700 hover:border-surface-600'
            }`}
          >
            {selectedAgent === null && (
              <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400 rounded-r" />
            )}
            <div className="text-sm font-semibold text-slate-200">{ta('filters.allAgents')}</div>
          </button>
          {agents.map((a) => (
            <button
              key={a.agent}
              onClick={() => setSelectedAgent(a.agent)}
              className={`flex-shrink-0 bg-surface-800 rounded-xl border px-4 py-3 text-left transition-colors relative overflow-hidden ${
                selectedAgent === a.agent
                  ? 'border-amber-500/60'
                  : 'border-surface-700 hover:border-surface-600'
              }`}
            >
              {selectedAgent === a.agent && (
                <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400 rounded-r" />
              )}
              <div className="text-sm font-semibold text-slate-200">{a.agent}</div>
              <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                <div>
                  <div className="text-slate-500">{ta('filters.occurrences')}</div>
                  <div className="text-slate-200 font-medium">{a.occurrences.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-slate-500">{ta('filters.affectedSessions')}</div>
                  <div className="text-slate-200 font-medium">{a.sessionCount}</div>
                </div>
                <div>
                  <div className="text-slate-500">{ta('filters.estWaste')}</div>
                  <div className="text-slate-200 font-medium">{formatTokens(a.waste)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <section className="hero-gradient overflow-hidden rounded-3xl border border-primary-500/20 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.28)]">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.95fr]">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.24em] text-primary-300/80">{ta('eyebrow')}</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-50">{ta('heroTitle')}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{ta('heroDescription')}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button onClick={handleRunAnalysis} disabled={analyzing} className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50">
                {analyzing ? ta('analyzing') : ta('runAnalysis')}
              </button>
              {batch ? <span className="text-xs text-slate-500">{ta('latestBatch')} {new Date(batch.createdAt).toLocaleString()}</span> : null}
            </div>
            {analyzeError ? <p className="mt-3 text-xs text-red-400">{analyzeError}</p> : null}
          </div>

          <div className="min-w-0 grid gap-3 sm:grid-cols-2">
            <SummaryCard label={ta('totalRulesTriggered')} value={hasAnalysisData ? rules.filter((rule) => rule.occurrences > 0).length : '-'} hint={ta('summary.rulesHint')} />
            <SummaryCard label={ta('totalOccurrences')} value={hasAnalysisData ? totalOccurrences : '-'} hint={ta('summary.occurrencesHint')} />
            <SummaryCard label={ta('summary.affectedSessions')} value={hasAnalysisData ? sessionCount : '-'} hint={ta('summary.sessionsHint')} />
            <SummaryCard label={to('summary.recoverable')} value={hasAnalysisData ? formatTokens(totalWaste) : '-'} hint={ta('summary.wasteHint')} accent="text-red-300" />
          </div>
        </div>
      </section>

      {!loading && !hasAnalysisData ? (
        <EmptyPanel title={ta('noAnalysisDataYet')} description={ta('noAnalysisDescription')} />
      ) : null}

      {hasAnalysisData ? (
        <section className="grid min-w-0 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="rounded-3xl border border-surface-700 bg-surface-800/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">{ta('workspace.queueTitle')}</h3>
                  <p className="mt-1 text-sm text-slate-500">{ta('workspace.queueDescription')}</p>
                </div>
                <div className="rounded-full border border-surface-700 bg-surface-900/80 px-3 py-1 text-xs text-slate-400">
                  {filteredQueue.length} {ta('workspace.items')}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <FilterChip active={activeFilter === 'all'} onClick={() => setActiveFilter('all')}>{ta('filters.all')}</FilterChip>
                <FilterChip active={activeFilter === 'high'} onClick={() => setActiveFilter('high')}>{ta('severity.high')}</FilterChip>
                <FilterChip active={activeFilter === 'medium'} onClick={() => setActiveFilter('medium')}>{ta('severity.medium')}</FilterChip>
                <FilterChip active={activeFilter === 'low'} onClick={() => setActiveFilter('low')}>{ta('severity.low')}</FilterChip>
              </div>
            </div>

            <div className="space-y-3" data-testid="issue-queue">
              {filteredQueue.map((issue) => (
                <QueueItem
                  key={issue.id}
                  issue={issue}
                  selected={issue.id === selectedIssue?.id}
                  onSelect={() => {
                    setSelectedIssueId(issue.id);
                    setActiveTab('evidence');
                  }}
                  t={to}
                />
              ))}
            </div>
          </div>

          <div className="min-w-0 xl:sticky xl:top-20 xl:self-start" data-testid="evidence-drawer">
            <div className="rounded-3xl border border-surface-700 bg-surface-800/70 p-5 shadow-[0_18px_60px_rgba(2,6,23,0.24)]">
              {selectedIssue ? (
                <>
                  <div className="flex min-w-0 flex-col gap-4 border-b border-surface-700 pb-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge-${selectedIssue.priority}`}>{selectedIssue.priority}</span>
                        <span className="inline-flex items-center rounded-full border border-surface-600 bg-surface-900/80 px-2.5 py-1 text-[11px] font-medium text-slate-300">{selectedIssue.category}</span>
                      </div>
                      <h3 className="mt-3 break-words text-xl font-semibold text-slate-50">{selectedIssue.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{selectedIssue.description}</p>
                      <p className="mt-2 text-xs text-slate-500">{to('basedOnRule')}: <span className="font-mono text-slate-400">{selectedIssue.technicalRule}</span></p>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 2xl:w-auto 2xl:min-w-[360px]">
                      <SummaryCard label={to('hits')} value={selectedIssue.hits} hint={ta('workspace.metricHits')} />
                      <SummaryCard label={to('potentialRecovery')} value={formatTokens(selectedIssue.impact)} hint={ta('workspace.metricRecovery')} accent="text-amber-300" />
                      <SummaryCard label={ta('summary.affectedSessions')} value={selectedSessions.length} hint={ta('workspace.metricSessions')} />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-surface-700 pb-4">
                    <FilterChip active={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')}>{ta('tabs.evidence')}</FilterChip>
                    <FilterChip active={activeTab === 'actions'} onClick={() => setActiveTab('actions')}>{ta('tabs.actions')}</FilterChip>
                    <FilterChip active={activeTab === 'strategy'} onClick={() => setActiveTab('strategy')}>{ta('tabs.strategy')}</FilterChip>
                    <div className="ml-auto">
                      <StreamingStatus status={streamStatus} error={streamError} />
                    </div>
                  </div>

                  <div className="mt-5 min-w-0 max-h-[72vh] overflow-y-auto pr-1">
                    {activeTab === 'evidence' ? (
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-100">{ta('workspace.sessionListTitle')}</h4>
                          <p className="mt-1 text-xs text-slate-500">{ta('workspace.sessionListDescription')}</p>
                        </div>

                        {selectedSessions.length > 0 ? (
                          <div className="space-y-2">
                            {selectedSessions
                              .slice((sessionPage - 1) * SESSION_PAGE_SIZE, sessionPage * SESSION_PAGE_SIZE)
                              .map((session) => (
                              <button
                                key={session.sessionId}
                                type="button"
                                onClick={() => { userClickedSessionRef.current = true; setSelectedSessionId(session.sessionId); }}
                                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                                  selectedSession?.sessionId === session.sessionId
                                    ? 'border-primary-500/30 bg-primary-500/10'
                                    : 'border-surface-700 bg-surface-900/40 hover:border-surface-600'
                                }`}
                              >
                                <div>
                                  <div className="text-sm text-slate-200">{session.title || ta('session')}</div>
                                  <div className="mt-1 font-mono text-xs text-slate-500">{session.sessionId}</div>
                                  <div className="mt-1 text-xs text-slate-500">{session.agent || ta('workspace.unknownAgent')}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{ta('estWaste')}</div>
                                  <div className="font-mono text-sm text-red-400">{formatTokens(session.waste ?? selectedIssue.impact)}</div>
                                </div>
                              </button>
                            ))}
                            <Pagination
                              page={sessionPage}
                              totalPages={Math.ceil(selectedSessions.length / SESSION_PAGE_SIZE)}
                              onPageChange={setSessionPage}
                            />
                          </div>
                        ) : (
                          <EmptyPanel title={ta('noSessionData')} description={ta('workspace.noSessionDescription')} />
                        )}

                        {selectedSession ? <div ref={drillDownRef}><SessionDrillDown session={selectedSession} onClose={() => setSelectedSessionId(null)} /></div> : null}
                      </div>
                    ) : null}

                    {activeTab === 'actions' ? (
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-100">{to('nextActions')}</h4>
                          <p className="mt-1 text-xs text-slate-500">{ta('workspace.actionsDescription')}</p>
                        </div>
                        {selectedIssue.steps.length > 0 ? (
                          <div className="space-y-3">
                            {selectedIssue.steps.map((step, i) => (
                              <div key={i} className="flex items-start gap-3 rounded-2xl border border-surface-700 bg-surface-900/40 p-4 text-sm leading-6 text-slate-300">
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-500/15 text-xs font-semibold text-primary-300">{i + 1}</span>
                                <span>{step}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyPanel title={to('noOptimizationIssues')} description={ta('workspace.noActionsDescription')} />
                        )}
                      </div>
                    ) : null}

                    {activeTab === 'strategy' ? (
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-3 rounded-2xl border border-surface-700 bg-surface-900/40 p-4">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-100">{to('aiOptimizationReport')}</h4>
                            <p className="mt-1 text-xs text-slate-500">{to('aiReportDescription')}</p>
                          </div>
                          <button
                            onClick={startStrategyAnalysis}
                            disabled={streamStatus === 'connecting' || streamStatus === 'streaming'}
                            className={`inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 ${(streamStatus === 'connecting' || streamStatus === 'streaming') ? 'cursor-not-allowed opacity-50' : ''}`}
                          >
                            {streamStatus === 'streaming' ? to('analyzingBtn') : to('analyzeWithAI')}
                          </button>
                        </div>

                        {recommendations.length > 0 ? (
                          <div className="space-y-3">
                            {recommendations.map((rec) => (
                              <div key={rec.id} className="rounded-2xl border border-surface-700 bg-surface-900/40 p-4">
                                <div className="flex items-center gap-2">
                                  <span className={`badge-${rec.priority}`}>{rec.priority}</span>
                                  <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">AI</span>
                                </div>
                                <h5 className="mt-3 text-sm font-semibold text-slate-100">{rec.title}</h5>
                                <p className="mt-2 text-xs leading-5 text-slate-400">{rec.description}</p>
                                {rec.steps?.length ? (
                                  <div className="mt-3 space-y-2">
                                    {rec.steps.map((step, i) => (
                                      <div key={i} className="flex items-start gap-2 text-xs text-slate-400">
                                        <span className="font-mono text-slate-600">{i + 1}.</span>
                                        <span>{step}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : streamText ? (
                          <div className="rounded-2xl border border-surface-700 bg-surface-900/40 p-4">
                            <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-300">{streamText}</pre>
                          </div>
                        ) : streamStatus === 'error' && streamError ? (
                          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                            <p className="text-sm font-medium text-red-400">{to('status.failed')}</p>
                            <p className="mt-2 text-sm text-slate-400">
                              {to(`status.error_${streamError.code}`, { defaultValue: streamError.message || to('status.failed') })}
                            </p>
                          </div>
                        ) : streamStatus === 'idle' ? (
                          <EmptyPanel title={to('clickAnalyzePrompt')} description={to('aiWillAnalyze')} />
                        ) : streamStatus === 'complete' ? (
                          <EmptyPanel title={to('noOptimizationIssues')} description={ta('workspace.strategyEmpty')} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyPanel title={ta('workspace.noIssueSelected')} description={ta('workspace.noIssueDescription')} />
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
