import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SeverityBadge } from '../components/SecurityShared.jsx';
import { RuleTable, useRuleManager } from '../components/RuleShared.jsx';
import Pagination from '../components/Pagination.jsx';

function SecurityRuleForm({ rule, onSave, onCancel }) {
  const { t } = useTranslation('security');
  const { t: tCommon } = useTranslation('common');
  const currentDefinition = rule?.definition || {};
  const [form, setForm] = useState({
    name: rule?.name || '',
    severity: rule?.severity?.toLowerCase() || 'medium',
    description: rule?.description || '',
    matchType: currentDefinition.matchType || 'regex',
    patterns: currentDefinition.patterns?.join('\n') || '',
    maskPrefix: currentDefinition.mask?.prefix ?? currentDefinition.maskLength ?? 4,
    maskSuffix: currentDefinition.mask?.suffix ?? currentDefinition.maskLength ?? 4,
  });
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const patterns = form.patterns.split('\n').map(p => p.trim()).filter(Boolean);
    if (patterns.length === 0) {
      setError(t(form.matchType === 'regex' ? 'rules.errorNoPattern' : 'rules.errorNoLiteral'));
      return;
    }
    if (form.matchType === 'regex') {
      for (const p of patterns) {
        try { new RegExp(p); } catch (err) {
          setError(t('rules.errorInvalidRegex', { pattern: p, message: err.message }));
          return;
        }
      }
    }
    onSave({
      ruleType: 'security',
      name: form.name,
      severity: form.severity,
      description: form.description,
      definition: {
        matchType: form.matchType,
        patterns,
        mask: {
          prefix: Number(form.maskPrefix),
          suffix: Number(form.maskSuffix),
        },
        category: 'leakage',
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('rules.labelName')}</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" required />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('rules.labelSeverity')}</label>
          <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="critical">{tCommon('severity.critical')}</option>
            <option value="high">{tCommon('severity.high')}</option>
            <option value="medium">{tCommon('severity.medium')}</option>
            <option value="low">{tCommon('severity.low')}</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">{t('rules.labelDescription')}</label>
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">{t('rules.labelPatterns')}</label>
        <select
          value={form.matchType}
          onChange={e => setForm({ ...form, matchType: e.target.value })}
          className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 mb-3"
        >
          <option value="regex">{t('rules.matchTypeRegex')}</option>
          <option value="literal">{t('rules.matchTypeLiteral')}</option>
        </select>
        <textarea value={form.patterns} onChange={e => setForm({ ...form, patterns: e.target.value })}
          rows={4}
          className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono"
          placeholder={form.matchType === 'regex'
            ? t('rules.regexPlaceholder')
            : t('rules.literalPlaceholder')} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('rules.labelMaskPrefix')}</label>
          <input type="number" value={form.maskPrefix} onChange={e => setForm({ ...form, maskPrefix: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" min="0" max="20" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('rules.labelMaskSuffix')}</label>
          <input type="number" value={form.maskSuffix} onChange={e => setForm({ ...form, maskSuffix: e.target.value })}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200" min="0" max="20" />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">{t('rules.cancel')}</button>
        <button type="submit" className="px-4 py-2 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg">{t('rules.save')}</button>
      </div>
    </form>
  );
}

export default function SecurityRules() {
  const { t } = useTranslation('security');
  const [page, setPage] = useState(1);
  const { rules, loading, toggling, saveError, setSaveError, handleToggle, handleSave, handleDelete, handleRestore, totalPages, counts } = useRuleManager('security', page);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  const onSave = async (data) => {
    const ok = await handleSave(data, editingRule);
    if (ok) { setShowForm(false); setEditingRule(null); setPage(1); }
  };

  const onEdit = (rule) => {
    setEditingRule(rule);
    setShowForm(true);
    setSaveError('');
  };

  const builtInCount = counts.builtIn ?? 0;
  const customCount = counts.custom ?? 0;
  const enabledCount = counts.enabled ?? 0;
  const totalCount = counts.total ?? 0;

  if (loading) return <div className="text-center py-8 text-slate-500">{t('status.loading', {ns:'common'})}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">{t('rules.title')}</h3>
          <p className="text-sm text-slate-500 mt-1">
            {t('rules.stats', { total: totalCount, enabled: enabledCount, builtin: builtInCount, custom: customCount })}
          </p>
        </div>
        <button
          onClick={() => { setEditingRule(null); setShowForm(true); setSaveError(''); }}
          className="px-4 py-2 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t('rules.addCustomRule')}
        </button>
      </div>

      {saveError && (
        <div className="text-sm text-red-400 bg-red-500/10 px-4 py-3 rounded-lg border border-red-500/20">{saveError}</div>
      )}

      {showForm && (
        <div className="bg-surface-800 rounded-xl border border-surface-700 p-6">
          <h4 className="text-sm font-semibold text-slate-200 mb-4">
            {editingRule ? t('rules.editRule') : t('rules.addCustomSecurityRule')}
          </h4>
          <SecurityRuleForm rule={editingRule} onSave={onSave} onCancel={() => { setShowForm(false); setEditingRule(null); }} />
        </div>
      )}

      <RuleTable
        rules={rules}
        toggling={toggling}
          onToggle={handleToggle}
          onEdit={onEdit}
          onDelete={handleDelete}
          onRestore={handleRestore}
          SeverityBadge={SeverityBadge}
      />
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
