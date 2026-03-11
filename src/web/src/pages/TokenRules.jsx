import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RuleTable, useRuleManager } from '../components/RuleShared.jsx';
import Pagination from '../components/Pagination.jsx';
import { useFetch } from '../hooks/useApi.js';
import { getTokenRuleCategories, getTokenRuleGuideCopy, getTokenRuleGuideEntry } from './tokenRuleGuides.js';

const TOKEN_SEVERITY_COLORS = {
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

function TokenSeverityBadge({ severity }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${TOKEN_SEVERITY_COLORS[severity] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
      {severity}
    </span>
  );
}

function formatTokens(n) {
  if (n == null || Number.isNaN(n)) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function GuideStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-surface-700 bg-surface-800/80 px-4 py-4">
      <div className="text-2xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-sm text-slate-300">{label}</div>
    </div>
  );
}

function LibraryRuleCard({ rule, guide, copy }) {
  if (!guide) return null;

  return (
    <article className="rounded-2xl border border-surface-700 bg-surface-800/75 p-5 shadow-[0_12px_40px_rgba(2,6,23,0.22)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-surface-600 bg-surface-900/80 px-2.5 py-1 text-[11px] font-medium text-slate-300">
              {guide.categoryLabel}
            </span>
            <span className="inline-flex items-center rounded-full border border-primary-500/25 bg-primary-500/10 px-2.5 py-1 text-[11px] font-medium text-primary-300">
              {copy.builtInBadge}
            </span>
            <TokenSeverityBadge severity={rule.severity} />
            {rule.enabled && (
              <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                {copy.keepEnabled}
              </span>
            )}
          </div>
          <h4 className="mt-3 text-lg font-semibold text-slate-100">{guide.title}</h4>
          <p className="mt-1 text-xs text-slate-500">
            {copy.technicalRule}: <span className="font-mono text-slate-400">{rule.id}</span> · {rule.name}
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 md:min-w-44">
          <div className="rounded-xl border border-surface-700 bg-surface-900/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{copy.hits}</div>
            <div className="mt-1 text-base font-semibold text-slate-100">{rule.occurrences || 0}</div>
          </div>
          <div className="rounded-xl border border-surface-700 bg-surface-900/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{copy.estimatedWaste}</div>
            <div className="mt-1 text-base font-semibold text-amber-300">{formatTokens(rule.estimatedWaste || 0)}</div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-surface-700/80 bg-surface-900/40 px-4 py-4">
        <p className="mt-2 text-sm leading-6 text-slate-300">{guide.summary}</p>
        {!rule.occurrences && (
          <p className="mt-3 text-xs text-slate-500">{copy.noHits}</p>
        )}
      </div>
    </article>
  );
}

function TokenRuleForm({ rule, onSave, onCancel }) {
  const { t } = useTranslation('rules');
  const [form, setForm] = useState({
    name: rule?.name || '',
    severity: rule?.severity?.toLowerCase() || 'medium',
    description: rule?.description || '',
    field: rule?.definition?.field || 'inputTokens',
    aggregation: rule?.definition?.aggregation || 'max',
    operator: rule?.definition?.operator || '>',
    threshold: rule?.definition?.threshold ?? 100000,
    scope: rule?.definition?.scope || 'session',
    minEvents: rule?.definition?.minEvents ?? 3,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ruleType: 'token',
      name: form.name,
      severity: form.severity,
      description: form.description,
      definition: {
        field: form.field,
        aggregation: form.aggregation,
        operator: form.operator,
        threshold: Number(form.threshold),
        scope: form.scope,
        minEvents: Number(form.minEvents),
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.name')}</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.severity')}</label>
          <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">{t('form.description')}</label>
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.field')}</label>
          <select value={form.field} onChange={e => setForm({ ...form, field: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="inputTokens">Input Tokens</option>
            <option value="outputTokens">Output Tokens</option>
            <option value="cacheRead">Cache Read</option>
            <option value="cacheWrite">Cache Write</option>
            <option value="contentLength">Content Length</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.aggregation')}</label>
          <select value={form.aggregation} onChange={e => setForm({ ...form, aggregation: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="max">{t('form.aggregationMax')}</option>
            <option value="sum">{t('form.aggregationSum')}</option>
            <option value="avg">{t('form.aggregationAvg')}</option>
            <option value="count">{t('form.aggregationCount')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.scope')}</label>
          <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="session">Session</option>
            <option value="event">Event</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.operator')}</label>
          <select value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
            <option value=">=">&gt;=</option>
            <option value="<=">&lt;=</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.threshold')}</label>
          <input type="number" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('form.minEvents')}</label>
          <input type="number" value={form.minEvents} onChange={e => setForm({ ...form, minEvents: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" min="1" />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('form.cancel')}</button>
        <button type="submit" className="px-4 py-2 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg">{t('form.save')}</button>
      </div>
    </form>
  );
}

export default function TokenRules() {
  const { t, i18n } = useTranslation('rules');
  const { t: ta } = useTranslation('analysis');
  const [page, setPage] = useState(1);
  const { rules: allRules, loading, toggling, saveError, setSaveError, handleToggle, handleSave, handleDelete, totalPages, counts } = useRuleManager('token', page);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);

  const { data: summaryData } = useFetch('/api/analysis/summary');
  const summaryRules = summaryData?.rules ?? [];

  // Extract unique agents from analysis summary
  const agents = useMemo(() => {
    const agentMap = {};
    for (const rule of summaryRules) {
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
  }, [summaryRules]);

  // Build a set of rule IDs that have hits from the selected agent
  const agentRuleIds = useMemo(() => {
    if (!selectedAgent) return null;
    const ids = new Set();
    for (const rule of summaryRules) {
      for (const s of rule.sessions || []) {
        if (s.agent === selectedAgent) { ids.add(rule.id); break; }
      }
    }
    return ids;
  }, [summaryRules, selectedAgent]);

  // Filter rules by selected agent
  const rules = useMemo(() => {
    if (!agentRuleIds) return allRules;
    return allRules.filter((rule) => agentRuleIds.has(rule.id));
  }, [allRules, agentRuleIds]);

  const guideCopy = useMemo(() => getTokenRuleGuideCopy(i18n.resolvedLanguage || i18n.language), [i18n.language, i18n.resolvedLanguage]);
  const categories = useMemo(() => getTokenRuleCategories(i18n.resolvedLanguage || i18n.language), [i18n.language, i18n.resolvedLanguage]);

  const onSave = async (data) => {
    const ok = await handleSave(data, editingRule);
    if (ok) { setShowForm(false); setEditingRule(null); setPage(1); }
  };

  const onEdit = (rule) => {
    setEditingRule(rule);
    setShowForm(true);
    setSaveError('');
  };

  const builtInCount = counts.builtIn ?? rules.filter((rule) => rule.builtIn).length;
  const customCount = counts.custom ?? rules.filter((rule) => !rule.builtIn).length;
  const enabledCount = counts.enabled ?? rules.filter((rule) => rule.enabled).length;
  const totalCount = counts.total ?? rules.length;
  const severityOrder = { high: 0, medium: 1, low: 2, critical: -1 };

  const builtInRules = useMemo(() => (
    rules
      .filter(rule => rule.builtIn)
      .sort((a, b) => {
        const severityDiff = (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9);
        if (severityDiff !== 0) return severityDiff;
        const wasteDiff = (b.estimatedWaste || 0) - (a.estimatedWaste || 0);
        if (wasteDiff !== 0) return wasteDiff;
        return (b.occurrences || 0) - (a.occurrences || 0);
      })
  ), [rules]);

  const groupedRules = useMemo(() => {
    const grouped = new Map(categories.map(category => [category.id, { ...category, rules: [] }]));
    for (const rule of builtInRules) {
      const guide = getTokenRuleGuideEntry(i18n.resolvedLanguage || i18n.language, rule);
      if (!guide) continue;
      const category = grouped.get(guide.category);
      if (category) {
        category.rules.push({ rule, guide });
      }
    }
    return Array.from(grouped.values()).filter(group => group.rules.length > 0);
  }, [builtInRules, categories, i18n.language, i18n.resolvedLanguage]);

  if (loading) return <div className="text-center py-8 text-slate-500">{t('loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">{t('header.title')}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {t('header.stats', { total: totalCount, enabled: enabledCount, builtin: builtInCount, custom: customCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-surface-600 bg-surface-800 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-surface-500 hover:bg-surface-700"
        >
          <svg className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
          {showAdvanced ? guideCopy.advancedHide : guideCopy.advancedShow}
        </button>
      </div>

      {saveError && (
        <div className="text-sm text-red-400 bg-red-500/10 px-4 py-3 rounded-lg border border-red-500/20">{saveError}</div>
      )}

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

      <section className="overflow-hidden rounded-3xl border border-primary-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.78))] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.28)]">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.95fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary-300/80">{guideCopy.libraryEyebrow}</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-slate-50">{guideCopy.libraryTitle}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{guideCopy.libraryDescription}</p>

            <div className="mt-5 space-y-2">
              {guideCopy.principles.map((item, index) => (
                <div key={index} className="flex items-start gap-3 text-sm text-slate-300">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500/15 text-xs font-semibold text-primary-300">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <GuideStat label={guideCopy.stats.total} value={totalCount} />
            <GuideStat label={guideCopy.stats.enabled} value={enabledCount} />
            <GuideStat label={guideCopy.stats.builtIn} value={builtInCount} />
            <GuideStat label={guideCopy.stats.custom} value={customCount} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-100">{guideCopy.categoryTitle}</h4>
            <p className="text-sm text-slate-500">{guideCopy.categoryDescription}</p>
          </div>
          <div className="rounded-full border border-surface-700 bg-surface-800 px-3 py-1 text-xs text-slate-400">
            {builtInCount} {guideCopy.builtInBadge}
          </div>
        </div>

        {groupedRules.map((group) => (
          <div key={group.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold text-slate-200">{group.label}</h5>
              <span className="rounded-full border border-surface-700 bg-surface-800 px-2.5 py-1 text-[11px] text-slate-400">
                {group.rules.length}
              </span>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {group.rules.map(({ rule, guide }) => (
                <LibraryRuleCard key={rule.id} rule={rule} guide={guide} copy={guideCopy} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-surface-700 bg-surface-800/80 p-5">
        <h4 className="text-base font-semibold text-slate-100">{guideCopy.customTitle}</h4>
        <p className="mt-2 text-sm leading-6 text-slate-400">{guideCopy.customDescription}</p>
        <p className="mt-3 text-xs text-slate-500">{guideCopy.addCustomRuleHint}</p>
      </section>

      {showAdvanced && (
        <section className="space-y-4 rounded-2xl border border-surface-700 bg-surface-800/60 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-base font-semibold text-slate-100">{guideCopy.advancedTitle}</h4>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">{guideCopy.advancedDescription}</p>
            </div>
            <button
              onClick={() => { setEditingRule(null); setShowForm(true); setSaveError(''); }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm text-white transition-colors hover:bg-primary-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('header.addCustomRule')}
            </button>
          </div>

          {showForm && (
            <div className="rounded-xl border border-surface-700 bg-surface-800 p-6">
              <h4 className="mb-4 text-sm font-semibold text-slate-200">
                {editingRule ? t('header.editRule') : t('header.addCustomTokenRule')}
              </h4>
              <TokenRuleForm rule={editingRule} onSave={onSave} onCancel={() => { setShowForm(false); setEditingRule(null); }} />
            </div>
          )}

          <RuleTable
            rules={rules}
            toggling={toggling}
            onToggle={handleToggle}
            onEdit={onEdit}
            onDelete={handleDelete}
            SeverityBadge={TokenSeverityBadge}
          />
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </section>
      )}
    </div>
  );
}
