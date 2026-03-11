import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useApi.js';
import { LoadingSpinner, EmptyState, StatCard, ToolBar } from '../components/PerformanceShared.jsx';
import Pagination from '../components/Pagination.jsx';

export default function PerformanceTools() {
  const { t } = useTranslation('performance');
  const [days, setDays] = useState(7);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [toolPage, setToolPage] = useState(1);

  // Reset page when filters change
  useEffect(() => { setToolPage(1); }, [days, selectedAgent]);

  const { data: agentData } = useFetch(
    `/api/performance/tools/agents-summary?days=${days}`, [days]
  );

  const toolsUrl = useMemo(() => {
    const base = selectedAgent
      ? `/api/performance/tools?days=${days}&agent=${encodeURIComponent(selectedAgent)}`
      : `/api/performance/tools?days=${days}`;
    return `${base}&page=${toolPage}&pageSize=20`;
  }, [days, selectedAgent, toolPage]);
  const { data, loading } = useFetch(toolsUrl, [days, selectedAgent, toolPage]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('tools.title')}</h3>
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

      {/* Agent filter cards */}
      {agentData?.agents && agentData.agents.length > 1 && (
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
            <div className="text-sm font-semibold text-slate-200">{t('tools.allAgents')}</div>
          </button>
          {agentData.agents.map((a) => (
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
                  <div className="text-slate-500">{t('tools.totalCalls')}</div>
                  <div className="text-slate-200 font-medium">{a.totalCalls.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-slate-500">{t('tools.overallSuccessRate')}</div>
                  <div className="text-slate-200 font-medium">{(a.overallSuccessRate * 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-slate-500">{t('tools.uniqueTools')}</div>
                  <div className="text-slate-200 font-medium">{a.uniqueTools}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && (!data || data.totalCalls === 0) && <EmptyState text={t('tools.noData')} />}

      {!loading && data && data.totalCalls > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label={t('tools.totalCalls')} value={data.totalCalls} />
            <StatCard
              label={t('tools.totalErrors')}
              value={data.totalErrors}
              alert={data.totalErrors > 0}
              alertColor="orange"
            />
            <StatCard
              label={t('tools.overallSuccessRate')}
              value={`${(data.overallSuccessRate * 100).toFixed(1)}%`}
              alert={data.overallSuccessRate < 0.9}
              alertColor="red"
            />
            <StatCard label={t('tools.uniqueTools')} value={data.uniqueTools} />
          </div>

          {/* Tool frequency distribution */}
          {data.topByCount && data.topByCount.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 p-5">
              <h4 className="text-sm font-medium text-slate-300 mb-4">{t('tools.frequencyDistribution')}</h4>
              <div className="space-y-2.5">
                {data.topByCount.map((tool) => (
                  <ToolBar key={tool.name} name={tool.name} count={tool.count} total={data.totalCalls} />
                ))}
              </div>
            </div>
          )}

          {/* Tool detail table */}
          {data.tools && data.tools.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700">
                <h4 className="text-sm font-medium text-slate-300">{t('tools.details')}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('tools.colName')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('tools.colCallCount')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('tools.colAvgInputSize')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('tools.colAvgOutputSize')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('tools.colErrors')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('tools.colSuccessRate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700">
                    {data.tools.map((tool, i) => (
                      <tr key={tool.name} className={`hover:bg-surface-750 transition-colors ${i % 2 === 1 ? 'bg-surface-900/30' : ''}`}>
                        <td className="px-4 py-3 text-slate-200 font-mono text-xs">{tool.name}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{tool.count.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">{formatBytes(tool.avgInputSize)}</td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">{formatBytes(tool.avgOutputSize)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={tool.errors > 0 ? 'text-orange-400' : 'text-slate-500'}>
                            {tool.errors}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-semibold border ${
                            tool.successRate < 0.9
                              ? 'bg-orange-500/10 text-orange-400 border-orange-500/25'
                              : 'bg-green-500/10 text-green-400 border-green-500/25'
                          }`}>
                            {(tool.successRate * 100).toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-surface-700">
                <Pagination
                  page={toolPage}
                  totalPages={data?.pagination?.totalPages ?? 1}
                  onPageChange={setToolPage}
                />
              </div>
            </div>
          )}

          {/* Top by token consumption */}
          {data.topBySize && data.topBySize.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700">
                <h4 className="text-sm font-medium text-slate-300">{t('tools.topByTokenConsumption')}</h4>
              </div>
              <div className="divide-y divide-surface-700">
                {data.topBySize.map((tool) => {
                  const totalSize = tool.totalInputSize + tool.totalOutputSize;
                  const inputPct = totalSize > 0 ? (tool.totalInputSize / totalSize) * 100 : 0;
                  const outputPct = totalSize > 0 ? (tool.totalOutputSize / totalSize) * 100 : 0;
                  return (
                    <div key={tool.name} className="px-5 py-3 flex items-center gap-4">
                      <span className="text-sm font-mono text-slate-300 truncate w-40 flex-shrink-0">{tool.name}</span>
                      <div className="flex-1 flex flex-col gap-1 min-w-0">
                        <span className="text-xs text-slate-500">
                          {t('tools.inputOutput', { input: formatBytes(tool.totalInputSize), output: formatBytes(tool.totalOutputSize) })}
                        </span>
                        <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-700">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${inputPct}%` }} />
                          <div className="h-full bg-amber-500 transition-all" style={{ width: `${outputPct}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {t('tools.nCalls', { count: tool.count })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
