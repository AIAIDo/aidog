import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useApi.js';
import { LoadingSpinner, EmptyState, CostBadge } from '../components/PerformanceShared.jsx';
import Pagination from '../components/Pagination.jsx';

export default function PerformanceAgents() {
  const { t } = useTranslation('performance');
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);

  // Reset page when days filter changes
  useEffect(() => { setPage(1); }, [days]);

  const { data, loading } = useFetch(
    `/api/performance/agents?days=${days}&page=${page}&pageSize=20`,
    [days, page]
  );

  const agents = data?.agents || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('agents.title')}</h3>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-surface-800 border border-surface-700 text-slate-300 text-sm rounded-lg px-3 py-1.5"
        >
          <option value={1}>{t('time.last1Day', {ns:'common'})}</option>
          <option value={7}>{t('time.last7Days', {ns:'common'})}</option>
          <option value={30}>{t('time.last30Days', {ns:'common'})}</option>
          <option value={90}>{t('time.last90Days', {ns:'common'})}</option>
        </select>
      </div>

      {loading && <LoadingSpinner />}

      {!loading && agents.length === 0 && <EmptyState text={t('agents.noData')} />}

      {!loading && agents.length > 0 && (
        <>
          {/* Agent cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((a) => (
              <div key={a.agent} className="bg-surface-800 rounded-xl border border-surface-700 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">{a.agent}</h4>
                  <CostBadge amount={a.totalCost} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-slate-500 text-xs">{t('agents.sessionCount')}</div>
                    <div className="text-slate-200 font-medium">{a.sessionCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">{t('agents.eventCount')}</div>
                    <div className="text-slate-200 font-medium">{a.eventCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">{t('agents.totalTokens')}</div>
                    <div className="text-slate-200 font-medium">{formatTokenShort(a.totalTokens)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">{t('agents.cacheHitRate')}</div>
                    <div className="text-slate-200 font-medium">{(a.cacheEfficiency * 100).toFixed(1)}%</div>
                  </div>
                </div>
                {/* Model distribution */}
                {a.modelDistribution && Object.keys(a.modelDistribution).length > 0 && (
                  <div className="pt-2 border-t border-surface-700">
                    <div className="text-xs text-slate-500 mb-1.5">{t('agents.modelDistribution')}</div>
                    <div className="space-y-1">
                      {Object.entries(a.modelDistribution)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3)
                        .map(([model, count]) => (
                          <div key={model} className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary-500/60 rounded-full"
                                style={{ width: `${(count / a.eventCount) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">
                              {model.split('-').slice(-2).join('-')}
                            </span>
                            <span className="text-xs text-slate-600">{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-700">
              <h4 className="text-sm font-medium text-slate-300">{t('agents.detailedComparison')}</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('agents.colAgent')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('agents.colSessions')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Input Token</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Output Token</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Cache Read</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('agents.colCost')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('agents.colCacheRate')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700">
                  {agents.map((a) => (
                    <tr key={a.agent} className="hover:bg-surface-750 transition-colors">
                      <td className="px-4 py-3 text-slate-200 font-medium">{a.agent}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{a.sessionCount}</td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono">{a.totalInput.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono">{a.totalOutput.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono">{a.totalCacheRead.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-mono">${a.totalCost.toFixed(4)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{(a.cacheEfficiency * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400/80">
            <span className="shrink-0 mt-0.5">ⓘ</span>
            <span>{t('overview.costDisclaimer')}</span>
          </div>

          <Pagination
            page={page}
            totalPages={data?.pagination?.totalPages ?? 1}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function formatTokenShort(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
