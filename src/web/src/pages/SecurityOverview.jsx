import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useScanData, ScoreGauge, ScoreBar, StatCard, TrendBadge, ScoreSparkline, SeverityBadge } from '../components/SecurityShared.jsx';

function getSecurityScoreLabel(t, grade) {
  const labelKey = {
    A: 'overview.scoreLabels.safe',
    B: 'overview.scoreLabels.caution',
    C: 'overview.scoreLabels.warning',
    D: 'overview.scoreLabels.danger',
    F: 'overview.scoreLabels.criticalRisk',
  }[grade];

  return labelKey ? t(labelKey) : grade;
}

export default function SecurityOverview() {
  const { t } = useTranslation('security');
  const navigate = useNavigate();
  const { scanResult, loading, handleScan } = useScanData('full');
  const [trendData, setTrendData] = useState(null);
  const [recentFindings, setRecentFindings] = useState([]);

  useEffect(() => {
    fetch('/api/security/history?days=30&type=full')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.trendData) setTrendData(data.trendData);
      })
      .catch(() => {});

    fetch('/api/security/findings?pageSize=5&scanType=full')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.findings) setRecentFindings(data.findings);
      })
      .catch(() => {});
  }, [scanResult]);

  const trend = scanResult?.securityScore?.trend || trendData;
  const exposureCount = (scanResult?.exposure?.portFindings?.length || 0) + (scanResult?.exposure?.localBindingFindings?.length || 0) + (scanResult?.exposure?.tunnelFindings?.length || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('overview.title')}</h3>
        <button
          onClick={() => handleScan('full')}
          disabled={loading}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? t('status.scanning', {ns:'common'}) : t('overview.rescan')}
        </button>
      </div>

      {/* Loading state */}
      {loading && !scanResult && (
        <div className="text-center py-16 text-slate-500">
          <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p>{t('overview.scanning')}</p>
        </div>
      )}

      {scanResult && (
        <>
          {/* Score card: gauge + bars */}
          {scanResult.securityScore && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 p-6 flex items-center gap-8">
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <ScoreGauge
                  score={scanResult.securityScore.score}
                  grade={scanResult.securityScore.grade}
                  label={getSecurityScoreLabel(t, scanResult.securityScore.grade)}
                />
                {trend && <TrendBadge direction={trend.direction} delta={trend.delta} />}
              </div>
              <div className="flex-1 space-y-3">
                {scanResult.securityScore.breakdown && (
                  <>
                    <ScoreBar label={t('overview.leakageSafety')} value={scanResult.securityScore.breakdown.leakage} max={50} />
                    <ScoreBar label={t('overview.exposureSafety')} value={scanResult.securityScore.breakdown.exposure} max={50} />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label={t('overview.filesScanned')} value={scanResult.leakage?.filesScanned || 0} />
            <StatCard label={t('overview.linesScanned')} value={scanResult.leakage?.linesScanned || 0} />
            <StatCard
              label={t('overview.leakageFindings')}
              value={scanResult.leakage?.totalFindings || 0}
              alert={scanResult.leakage?.totalFindings > 0}
              alertColor="red"
            />
            <StatCard
              label={t('overview.exposureRisks')}
              value={exposureCount}
              alert={exposureCount > 0}
              alertColor="orange"
            />
          </div>

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

          {/* Recent findings */}
          {recentFindings.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700">
                <h4 className="text-sm font-medium text-slate-300">{t('overview.recentFindings')}</h4>
              </div>
              <div className="divide-y divide-surface-700">
                {recentFindings.map((f, i) => (
                  <div
                    key={f.id || i}
                    className={`px-5 py-3 flex items-center gap-3 ${f.sessionId ? 'cursor-pointer hover:bg-surface-700/50 transition-colors' : ''}`}
                    onClick={f.sessionId ? () => navigate(`/sessions?id=${f.sessionId}`) : undefined}
                  >
                    <SeverityBadge severity={f.severity} />
                    <span className="text-sm text-slate-200 font-medium whitespace-nowrap">{f.ruleId ? t(`builtInRules.${f.ruleId}.name`, { defaultValue: f.ruleName }) : f.ruleName}</span>
                    {f.maskedSnippet && (
                      <span className="text-xs text-slate-500 font-mono truncate max-w-[240px]">{f.maskedSnippet}</span>
                    )}
                    {f.sessionId && (
                      <span className="ml-auto text-xs text-slate-500 font-mono truncate max-w-[200px] shrink-0">{f.sessionId}</span>
                    )}
                    <span className={`${f.sessionId ? '' : 'ml-auto'} text-xs text-slate-600 whitespace-nowrap shrink-0`}>
                      {f.filePath ? f.filePath.split('/').pop() : f.category}
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
