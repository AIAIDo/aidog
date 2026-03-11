import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import MessageList from '../components/MessageList.jsx';
import Pagination from '../components/Pagination.jsx';
import { useFetch } from '../hooks/useApi.js';

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
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(startTs, endTs) {
  if (!startTs || !endTs) return '-';
  const diff = endTs - startTs;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  return `${(diff / 3_600_000).toFixed(1)}h`;
}

/** Compact session row for the left panel list */
function SessionRow({ session, selected, onClick }) {
  const totalTokens = session.totalTokens || 0;
  return (
    <div
      onClick={onClick}
      className={`px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${
        selected
          ? 'bg-primary-500/10 border-primary-500'
          : 'border-transparent hover:bg-surface-800'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-300 truncate max-w-[220px]" title={session.title || session.sessionId}>
          {session.title || `${session.sessionId.slice(0, 16)}...`}
        </span>
        <span className="text-[10px] text-slate-600 shrink-0 ml-1">{formatTime(session.startTime)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-slate-400">{session.agent}</span>
        <span className="text-[10px] text-slate-600 truncate max-w-[120px]" title={session.projectName}>
          {session.projectName || '-'}
        </span>
        <span className="ml-auto font-mono text-xs text-amber-400">{formatTokens(totalTokens)}</span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
        <span>{session.eventCount} events</span>
        <span>{formatDuration(session.startTime, session.endTime)}</span>
        {session.models?.length > 0 && (
          <span className="truncate max-w-[140px]">{session.models.join(', ')}</span>
        )}
      </div>
    </div>
  );
}

/** Right panel: session summary header + message list */
function SessionPanel({ session }) {
  const { t } = useTranslation('sessions');
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full text-slate-600 text-sm">
        {t('selectSession')}
      </div>
    );
  }

  const totalTokens = (session.totalInput || 0) + (session.totalOutput || 0);

  return (
    <div className="flex flex-col h-full">
      {/* Session summary header */}
      <div className="shrink-0 border-b border-surface-700 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300 truncate">
            {session.title || <span className="font-mono text-primary-400">{session.sessionId}</span>}
          </h3>
          <div className="flex gap-3 text-[10px] text-slate-500 shrink-0">
            <span>{session.agent}</span>
            <span>{session.projectName || '-'}</span>
          </div>
        </div>
        {session.title && (
          <div className="text-[10px] font-mono text-slate-600 truncate" title={session.sessionId}>
            {session.sessionId}
          </div>
        )}
        {/* Stats row */}
        <div className="flex gap-4 text-xs">
          <div>
            <span className="text-slate-600">{t('input')}: </span>
            <span className="font-mono text-amber-400">{formatTokens(session.totalInput)}</span>
          </div>
          <div>
            <span className="text-slate-600">{t('output')}: </span>
            <span className="font-mono text-orange-400">{formatTokens(session.totalOutput)}</span>
          </div>
          <div>
            <span className="text-slate-600">{t('total')}: </span>
            <span className="font-mono text-slate-300">{formatTokens(totalTokens)}</span>
          </div>
          <div>
            <span className="text-slate-600">{t('cacheRead')}: </span>
            <span className="font-mono text-cyan-400">{formatTokens(session.totalCacheRead)}</span>
          </div>
          <div>
            <span className="text-slate-600">{t('cacheWrite')}: </span>
            <span className="font-mono text-teal-400">{formatTokens(session.totalCacheWrite)}</span>
          </div>
          <div>
            <span className="text-slate-600">{t('events')}: </span>
            <span className="font-mono text-slate-400">{session.eventCount}</span>
          </div>
          <div>
            <span className="text-slate-600">{t('duration')}: </span>
            <span className="font-mono text-slate-400">{formatDuration(session.startTime, session.endTime)}</span>
          </div>
          {session.models?.length > 0 && (
            <div>
              <span className="text-slate-600">{t('models')}: </span>
              <span className="text-slate-400">{session.models.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Message list - scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <MessageList sessionId={session.sessionId} />
      </div>
    </div>
  );
}

export default function Sessions() {
  const { t } = useTranslation('sessions');
  const [searchParams] = useSearchParams();
  const initialId = searchParams.get('id') || '';
  const [search, setSearch] = useState(initialId);
  const [searchInput, setSearchInput] = useState(initialId);
  const [page, setPage] = useState(1);
  const [selectedSession, setSelectedSession] = useState(null);
  const [agentFilter, setAgentFilter] = useState('');
  const [days, setDays] = useState(90);
  const [sessionSort, setSessionSort] = useState({ key: 'time', dir: 'desc' });
  const pageSize = 30;

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize, days });
    if (search) params.set('search', search);
    if (agentFilter) params.set('agent', agentFilter);
    return `/api/sessions?${params}`;
  }, [search, page, agentFilter, days]);

  const { data: sessionsData } = useFetch(fetchUrl, [fetchUrl]);

  // Auto-select session from URL query param ?id=xxx
  useEffect(() => {
    const id = searchParams.get('id');
    if (!id) return;
    // Already selected
    if (selectedSession?.sessionId === id) return;
    // Try current page first
    if (sessionsData?.sessions) {
      const match = sessionsData.sessions.find((s) => s.sessionId === id);
      if (match) { setSelectedSession(match); return; }
    }
    // Fetch the specific session by ID
    fetch(`/api/sessions/${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSelectedSession(data); })
      .catch(() => {});
  }, [searchParams, sessionsData]);

  const sessions = sessionsData?.sessions ?? [];
  const totalSessions = sessionsData?.total ?? 0;
  const totalPages = Math.ceil(totalSessions / pageSize);

  const filteredSessions = useMemo(() => {
    let list = [...sessions];
    const { key, dir } = sessionSort;
    list.sort((a, b) => {
      let va, vb;
      if (key === 'time') { va = a.startTime || 0; vb = b.startTime || 0; }
      else { va = a.totalTokens || 0; vb = b.totalTokens || 0; }
      return dir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }, [sessions, agentFilter, sessionSort]);

  const agents = sessionsData?.agents ?? [...new Set(sessions.map((s) => s.agent).filter(Boolean))];

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left panel: session list */}
      <div className="w-[360px] shrink-0 border-r border-surface-700 flex flex-col bg-surface-900/50">
        {/* Search & filters */}
        <div className="shrink-0 p-3 border-b border-surface-700 space-y-2">
          <form onSubmit={handleSearch} className="flex gap-1.5">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="input-field text-xs flex-1 py-1.5 px-2"
            />
            <button type="submit" className="btn-secondary text-xs py-1.5 px-2">
              {t('go')}
            </button>
          </form>
          <div className="flex gap-2 items-center">
            <select
              value={agentFilter}
              onChange={(e) => { setAgentFilter(e.target.value); setPage(1); }}
              className="select-field text-xs py-1 flex-1"
            >
              <option value="">{t('allAgents')}</option>
              {agents.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <select
              value={days}
              onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}
              className="select-field text-xs py-1 shrink-0 w-28"
            >
              <option value={1}>{t('time.last1Day', {ns:'common'})}</option>
              <option value={7}>{t('time.last7Days', {ns:'common'})}</option>
              <option value={30}>{t('time.last30Days', {ns:'common'})}</option>
              <option value={90}>{t('time.last90Days', {ns:'common'})}</option>
            </select>
            {(search || agentFilter) && (
              <button
                onClick={() => { setSearch(''); setSearchInput(''); setAgentFilter(''); setPage(1); }}
                className="text-[10px] text-slate-500 hover:text-slate-400"
              >
                {t('clear')}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-600">
              {t('sessionCount', { count: totalSessions })}
            </span>
            <div className="flex gap-1 text-[10px]">
              {[{ key: 'time', label: t('sortTime') }, { key: 'size', label: t('sortSize') }].map(({ key, label }) => {
                const active = sessionSort.key === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSessionSort(prev =>
                      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
                    )}
                    className={`px-1.5 py-0.5 rounded transition-colors ${
                      active ? 'bg-primary-500/20 text-primary-400' : 'text-slate-600 hover:text-slate-400'
                    }`}
                  >
                    {label}{active ? (sessionSort.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Session list - scrollable */}
        <div className="flex-1 overflow-y-auto divide-y divide-surface-700/50">
          {filteredSessions.length === 0 && (
            <div className="text-xs text-slate-600 text-center py-8">{t('noSessionsFound')}</div>
          )}
          {filteredSessions.map((s) => (
            <SessionRow
              key={s.sessionId}
              session={s}
              selected={selectedSession?.sessionId === s.sessionId}
              onClick={() => setSelectedSession(s)}
            />
          ))}
        </div>

        {/* Pagination */}
        <div className="shrink-0 border-t border-surface-700 px-2 py-2">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      {/* Right panel: session detail + messages */}
      <div className="flex-1 min-w-0">
        <SessionPanel session={selectedSession} />
      </div>
    </div>
  );
}
