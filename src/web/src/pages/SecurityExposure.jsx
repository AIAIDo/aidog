import React from 'react';
import { useTranslation } from 'react-i18next';
import { useScanData, SeverityBadge } from '../components/SecurityShared.jsx';

export default function SecurityExposure() {
  const { t } = useTranslation('security');
  const { scanResult, loading, handleScan } = useScanData('exposure');
  const exposure = scanResult?.exposure;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-200">{t('exposure.title')}</h3>
        <button onClick={() => handleScan('exposure')} disabled={loading}
          className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
          {loading ? t('exposure.screening') : t('exposure.rescreen')}
        </button>
      </div>

      {loading && !exposure && (
        <div className="text-center py-16 text-slate-500">
          <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p>{t('exposure.screeningMsg')}</p>
        </div>
      )}

      {exposure && (
        <>
          {exposure.note && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-sm text-yellow-300">
              {exposure.note}
            </div>
          )}

          <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
            <div className="text-sm text-slate-400">{t('exposure.publicIp')}</div>
            <div className="text-lg font-mono text-slate-200">{exposure.publicIp || t('exposure.unableToRetrieve')}</div>
          </div>

          {exposure.portFindings?.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-700">
                <h4 className="text-sm font-semibold text-slate-300">{t('exposure.portReachability')}</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-surface-700">
                    <th className="px-4 py-2">{t('exposure.colSeverity')}</th>
                    <th className="px-4 py-2">{t('exposure.colPort')}</th>
                    <th className="px-4 py-2">{t('exposure.colService')}</th>
                    <th className="px-4 py-2">{t('exposure.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.portFindings.map((f, i) => (
                    <tr key={i} className="border-b border-surface-700/50">
                      <td className="px-4 py-2"><SeverityBadge severity={f.severity} /></td>
                      <td className="px-4 py-2 font-mono text-slate-300">{f.port}</td>
                      <td className="px-4 py-2 text-slate-400">{f.service || '-'}</td>
                      <td className="px-4 py-2">
                        {f.reachable
                          ? <span className="text-red-400 font-medium">{t('exposure.reachable')}</span>
                          : <span className="text-green-400">{t('exposure.unreachable')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {exposure.tunnelFindings?.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-700">
                <h4 className="text-sm font-semibold text-slate-300">{t('exposure.tunnelTools')}</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-surface-700">
                    <th className="px-4 py-2">{t('exposure.colTool')}</th>
                    <th className="px-4 py-2">{t('exposure.colPid')}</th>
                    <th className="px-4 py-2">{t('exposure.colCommand')}</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.tunnelFindings.map((f, i) => (
                    <tr key={i} className="border-b border-surface-700/50">
                      <td className="px-4 py-2 text-orange-400 font-medium">{f.tool}</td>
                      <td className="px-4 py-2 font-mono text-slate-300">{f.pid || '-'}</td>
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs truncate max-w-xs">{f.command || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!exposure.portFindings?.length && !exposure.tunnelFindings?.length && (
            <div className="text-center py-8 text-green-400">
              <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{t('exposure.noExposureRisk')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
