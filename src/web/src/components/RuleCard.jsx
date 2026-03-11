import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const SEVERITY_STYLES = {
  high: {
    badge: 'badge-high',
    border: 'border-red-500/20',
    icon: '\u26a0',
  },
  medium: {
    badge: 'badge-medium',
    border: 'border-yellow-500/20',
    icon: '\u25b2',
  },
  low: {
    badge: 'badge-low',
    border: 'border-blue-500/20',
    icon: '\u25cf',
  },
};

export default function RuleCard({ rule, onDrillDown }) {
  const { t } = useTranslation('rules');
  const [expanded, setExpanded] = useState(false);
  const severity = SEVERITY_STYLES[rule.severity] || SEVERITY_STYLES.low;

  return (
    <div
      className={`card-hover cursor-pointer ${severity.border}`}
      onClick={() => onDrillDown?.(rule)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={severity.badge}>{rule.severity}</span>
            <h4 className="text-sm font-medium text-slate-200 truncate">
              {rule.name || rule.ruleId}
            </h4>
          </div>
          {rule.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
              {rule.description}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-xs text-slate-400">
            {rule.occurrences || 0} {t('ruleCard.hits')}
          </span>
          {rule.estimatedWaste != null && (
            <span className="font-mono text-xs text-red-400">
              ~{formatTokens(rule.estimatedWaste)} {t('ruleCard.wasted')}
            </span>
          )}
        </div>
      </div>

      {/* Expandable evidence */}
      {rule.evidence && rule.evidence.length > 0 && (
        <div className="mt-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {t('ruleCard.evidenceItems', { count: rule.evidence.length })}
          </button>

          {expanded && (
            <div className="mt-2 space-y-2">
              {rule.evidence.slice(0, 5).map((ev, i) => (
                <div
                  key={i}
                  className="bg-surface-900 rounded px-3 py-2 text-xs border border-surface-700"
                >
                  <div className="flex items-center gap-3 text-slate-400">
                    <span className="font-mono">{t('ruleCard.turn')} {ev.turn}</span>
                    <span className="font-mono text-primary-400">
                      {formatTokens(ev.tokens)} {t('ruleCard.tokens')}
                    </span>
                    {ev.waste && (
                      <span className="font-mono text-red-400">
                        {formatTokens(ev.waste)} {t('ruleCard.waste')}
                      </span>
                    )}
                  </div>
                  {ev.reason && (
                    <p className="text-slate-500 mt-1">{ev.reason}</p>
                  )}
                </div>
              ))}
              {rule.evidence.length > 5 && (
                <p className="text-xs text-slate-600 pl-3">
                  {t('ruleCard.more', { count: rule.evidence.length - 5 })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTokens(n) {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
