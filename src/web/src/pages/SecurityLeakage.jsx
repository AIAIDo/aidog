import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScanData, SeverityBadge, StatCard, Pagination } from '../components/SecurityShared.jsx';

export default function SecurityLeakage() {
  const { t } = useTranslation('security');
  const navigate = useNavigate();
  const { scanResult, loading, handleScan } = useScanData('leakage');
  const leakage = scanResult?.leakage;
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const pageSize = 50;

  const fetchPage = useCallback(async (p, scanId) => {
    setFetching(true);
    try {
      const params = new URLSearchParams({ category: 'leakage', page: String(p), pageSize: String(pageSize) });
      if (scanId) params.set('scanId', scanId);
      const res = await fetch(`/api/security/findings?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPageData(data);
      }
    } catch (err) {
      console.error('Failed to fetch findings:', err);
    } finally {
      setFetching(false);
    }
  }, [pageSize]);

  useEffect(() => {
    if (scanResult?.scanId) {
      fetchPage(page, scanResult.scanId);
    }
  }, [scanResult?.scanId, page, fetchPage]);

  const prevScanId = React.useRef(scanResult?.scanId);
  useEffect(() => {
    if (scanResult?.scanId && scanResult.scanId !== prevScanId.current) {
      prevScanId.current = scanResult.scanId;
      setPage(1);
    }
  }, [scanResult?.scanId]);

  const findings = pageData?.findings || [];
  const pagination = pageData?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('leakage.title')}</h3>
        <button onClick={() => handleScan('leakage')} disabled={loading}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
          {loading ? t('status.scanning', {ns:'common'}) : t('leakage.rescan')}
        </button>
      </div>

      {loading && !leakage && (
        <div className="text-center py-16 text-slate-500">
          <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p>{t('leakage.scanning')}</p>
        </div>
      )}

      {leakage && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label={t('leakage.filesScanned')} value={leakage.filesScanned || 0} />
            <StatCard label={t('leakage.linesScanned')} value={leakage.linesScanned || 0} />
            <StatCard label={t('leakage.issuesFound')} value={pagination?.total ?? leakage.totalFindings ?? 0} alert={(pagination?.total ?? leakage.totalFindings ?? 0) > 0} />
          </div>

          {(findings.length > 0 || fetching) ? (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-surface-700">
                    <th className="px-4 py-2">{t('leakage.colSeverity')}</th>
                    <th className="px-4 py-2">{t('leakage.colRule')}</th>
                    <th className="px-4 py-2">{t('leakage.colMaskedSnippet')}</th>
                    <th className="px-4 py-2">{t('leakage.colFile')}</th>
                    <th className="px-4 py-2">{t('leakage.colLine')}</th>
                  </tr>
                </thead>
                <tbody className={fetching ? 'opacity-50' : ''}>
                  {findings.map((f, i) => (
                    <tr key={i} className="border-b border-surface-700/50">
                      <td className="px-4 py-2"><SeverityBadge severity={f.severity} /></td>
                      <td className="px-4 py-2 text-slate-300">{f.ruleId ? t(`builtInRules.${f.ruleId}.name`, { defaultValue: f.ruleName || f.ruleId }) : (f.ruleName || f.ruleId)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-400 max-w-xs truncate">{f.maskedSnippet || '-'}</td>
                      <td className="px-4 py-2 text-xs truncate max-w-[200px]">
                        {f.sessionId ? (
                          <button
                            onClick={() => navigate(`/sessions?id=${f.sessionId}`)}
                            className="text-primary-400 hover:text-primary-300 hover:underline truncate max-w-[200px]"
                            title={`查看 Session: ${f.sessionId}`}
                          >
                            {f.filePath ? f.filePath.split('/').pop() : f.sessionId.slice(0, 12)}
                          </button>
                        ) : (
                          <span className="text-slate-400">{f.filePath ? f.filePath.split('/').pop() : '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-500 font-mono">{f.lineNumber || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pagination && (
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  onPageChange={setPage}
                />
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-green-400">
              <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{t('leakage.noLeakageFound')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
