import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const SEVERITY_COLORS = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-green-500/20 text-green-400 border-green-500/30',
};

export function SeverityBadge({ severity }) {
  const { t } = useTranslation('common');
  const severityLabels = {
    critical: t('severity.critical'),
    high: t('severity.high'),
    medium: t('severity.medium'),
    low: t('severity.low'),
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEVERITY_COLORS[severity] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
      {severityLabels[severity] || severity}
    </span>
  );
}

export function ScoreGauge({ score, grade, label }) {
  const color = score >= 90 ? 'text-green-400' : score >= 75 ? 'text-blue-400' : score >= 60 ? 'text-yellow-400' : score >= 40 ? 'text-orange-400' : 'text-red-400';
  const strokeColor = score >= 90 ? '#4ade80' : score >= 75 ? '#60a5fa' : score >= 60 ? '#facc15' : score >= 40 ? '#fb923c' : '#f87171';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-surface-700" />
          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round" stroke={strokeColor}
            strokeDasharray={`${(score / 100) * 264} 264`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold ${color}`}>{score}</span>
        </div>
      </div>
      <span className={`text-sm font-medium ${color}`}>{grade} · {label}</span>
    </div>
  );
}

export function StatCard({ label, value, alert, alertColor = 'red' }) {
  const alertClass = alert
    ? (alertColor === 'orange' ? 'text-orange-400' : 'text-red-400')
    : 'text-slate-200';

  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${alertClass}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function ScoreBar({ label, value, max }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : pct >= 40 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-400 w-20">{label}</span>
      <div className="flex-1 h-2 bg-surface-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-mono text-slate-300 w-12 text-right">{value}/{max}</span>
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPageChange }) {
  const { t } = useTranslation('common');
  if (totalPages <= 1) return null;

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('...');
    }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-slate-500">{t('pagination.total', { count: total })}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className="px-2.5 py-1 rounded text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          {t('pagination.prev')}
        </button>
        {getPageNumbers().map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-slate-600">...</span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)}
              className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                p === page ? 'bg-primary-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'
              }`}>
              {p}
            </button>
          )
        )}
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className="px-2.5 py-1 rounded text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}

export function TrendBadge({ direction, delta }) {
  const { t } = useTranslation('common');
  if (direction === 'stable' && delta === 0) {
    return <span className="inline-flex items-center gap-1 text-sm text-slate-500">— {t('trend.stable')}</span>;
  }

  const isPositive = delta > 0;
  const color = isPositive ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-slate-400';
  const arrow = isPositive ? '↑' : delta < 0 ? '↓' : '→';
  const labelMap = { improving: t('trend.improving'), declining: t('trend.declining'), stable: t('trend.stable') };

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`}>
      {arrow} {delta > 0 ? '+' : ''}{delta} <span className="text-xs opacity-75">{labelMap[direction] || direction}</span>
    </span>
  );
}

export function ScoreSparkline({ data, height = 80 }) {
  const { t } = useTranslation('security');
  const [containerRef, setContainerRef] = useState(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef);
    return () => observer.disconnect();
  }, [containerRef]);
  if (!data || data.length === 0) {
    return <div className="text-sm text-slate-600 italic">{t('shared.noTrendData')}</div>;
  }

  if (width === 0) {
    return <div ref={setContainerRef} style={{ height }} />;
  }

  const padding = { top: 4, right: 8, bottom: 18, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const scores = data.map(d => d.score);
  const minScore = Math.min(...scores, 0);
  const maxScore = Math.max(...scores, 100);
  const range = maxScore - minScore || 1;

  const points = data.map((d, i) => ({
    x: padding.left + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW),
    y: padding.top + chartH - ((d.score - minScore) / range) * chartH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  const latest = data[data.length - 1];
  const scoreColor = latest.score >= 90 ? '#4ade80' : latest.score >= 75 ? '#60a5fa' : latest.score >= 60 ? '#facc15' : latest.score >= 40 ? '#fb923c' : '#f87171';

  // Unique gradient ID to avoid conflicts if multiple sparklines render
  const gradId = `sparkGrad-${data.length}-${latest.score}`;

  return (
    <div ref={setContainerRef}>
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={scoreColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={scoreColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={scoreColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3.5 : 0}
            fill={scoreColor} stroke={scoreColor} strokeWidth="1.5" />
        ))}
        {data.length > 1 && (
          <>
            <text x={points[0].x} y={height - 2} textAnchor="start" className="fill-slate-600 text-[10px]">{data[0].date.slice(5)}</text>
            <text x={points[points.length - 1].x} y={height - 2} textAnchor="end" className="fill-slate-600 text-[10px]">{latest.date.slice(5)}</text>
          </>
        )}
      </svg>
    </div>
  );
}

export function useScanData(autoScanType = 'full') {
  const [scanResult, setScanResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleScan = useCallback(async (type = 'full') => {
    setLoading(true);
    try {
      const res = await fetch('/api/security/scan/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Scan failed');
      }
      const data = await res.json();
      setScanResult(data);
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ type: autoScanType });
    fetch(`/api/security/scan/latest?${params}`)
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then(data => {
        if (data?.scan) {
          setScanResult({
            scanId: data.scan.id,
            scannedAt: data.scan.scannedAt,
            securityScore: data.scan.securityScore,
            leakage: {
              filesScanned: data.scan.filesScanned,
              linesScanned: data.scan.linesScanned,
              totalFindings: data.findings?.filter(f => f.category === 'leakage').length || 0,
              findings: data.findings?.filter(f => f.category === 'leakage') || [],
            },
            exposure: {
              publicIp: data.scan.publicIp,
              note: data.scan.note,
              portFindings: data.findings?.filter(f => f.category === 'exposure' && f.ruleId === 'port_exposure') || [],
              localBindingFindings: data.findings?.filter(f => f.category === 'exposure' && f.ruleId === 'local_binding') || [],
              tunnelFindings: data.findings?.filter(f => f.category === 'exposure' && f.ruleId === 'tunnel_detected') || [],
            },
          });
          setLoading(false);
        } else {
          handleScan(autoScanType);
        }
      })
      .catch(() => {
        handleScan(autoScanType);
      });
  }, [autoScanType, handleScan]);

  return { scanResult, loading, handleScan };
}
