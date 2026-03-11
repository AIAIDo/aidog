import React from 'react';
import { useTranslation } from 'react-i18next';

export function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-primary-500' : 'bg-surface-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

export function RuleTable({ rules, toggling, onToggle, onEdit, onDelete, onRestore, SeverityBadge }) {
  const { t } = useTranslation('rules');
  const { t: tSec } = useTranslation('security');
  const getRuleName = (r) => r.builtIn && r.type === 'security' ? tSec(`builtInRules.${r.id}.name`, { defaultValue: r.name }) : r.name;
  const getRuleDesc = (r) => r.builtIn && r.type === 'security' ? tSec(`builtInRules.${r.id}.description`, { defaultValue: r.description }) : r.description;
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-surface-700">
            <th className="px-4 py-2 w-16">{t('table.status')}</th>
            <th className="px-4 py-2">{t('table.id')}</th>
            <th className="px-4 py-2">{t('table.name')}</th>
            <th className="px-4 py-2">{t('table.severity')}</th>
            <th className="px-4 py-2">{t('table.type')}</th>
            <th className="px-4 py-2">{t('table.description')}</th>
            <th className="px-4 py-2 w-24">{t('table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-slate-500">{t('empty.noRules')}</td>
            </tr>
          ) : (
            rules.map((r) => (
              <tr key={r.id} className="border-b border-surface-700/50 hover:bg-surface-700/30">
                <td className="px-4 py-2">
                  <Toggle enabled={r.enabled} onChange={(enabled) => onToggle(r, enabled)} disabled={toggling.has(r.id)} />
                </td>
                <td className="px-4 py-2 font-mono text-slate-300 text-xs">{r.id}</td>
                <td className="px-4 py-2 text-slate-200">{getRuleName(r)}</td>
                <td className="px-4 py-2"><SeverityBadge severity={r.severity} /></td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${r.builtIn ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    {r.builtIn ? t('ruleType.builtIn', { ns: 'common' }) : t('ruleType.custom', { ns: 'common' })}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-400 text-xs max-w-xs truncate">{getRuleDesc(r) || '-'}</td>
                <td className="px-4 py-2">
                  {(r.editable || r.deletable || r.hasOverride) && (
                    <div className="flex gap-2">
                      {r.editable && (
                        <button onClick={() => onEdit(r)} className="text-xs text-slate-400 hover:text-primary-400">{t('actions.edit', { ns: 'common' })}</button>
                      )}
                      {r.hasOverride && onRestore && (
                        <button onClick={() => onRestore(r)} className="text-xs text-amber-400 hover:text-amber-300">{t('actions.restore', { ns: 'common', defaultValue: 'Restore' })}</button>
                      )}
                      {r.deletable && (
                        <button onClick={() => onDelete(r)} className="text-xs text-slate-400 hover:text-red-400">{t('actions.delete', { ns: 'common' })}</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Shared hook for rule management operations.
 */
export function useRuleManager(ruleType, page = 1) {
  const { t } = useTranslation('rules');
  const [rules, setRules] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [toggling, setToggling] = React.useState(new Set());
  const [saveError, setSaveError] = React.useState('');
  const [totalPages, setTotalPages] = React.useState(1);
  const [counts, setCounts] = React.useState({});

  const fetchRules = React.useCallback(() => {
    setLoading(true);
    fetch(`/api/rules?type=${ruleType}&page=${page}&pageSize=20`)
      .then(res => res.json())
      .then(data => {
        setRules(data.rules || []);
        setTotalPages(data.pagination?.totalPages ?? 1);
        setCounts(data.counts || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ruleType, page]);

  React.useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleToggle = async (rule, enabled) => {
    setToggling(prev => new Set(prev).add(rule.id));
    try {
      await fetch(`/api/rules/${rule.id}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, type: rule.type }),
      });
      fetchRules();
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(rule.id); return s; });
    }
  };

  const handleSave = async (data, editingRule) => {
    setSaveError('');
    try {
      const isBuiltIn = !!editingRule?.builtIn;
      const url = editingRule
        ? (isBuiltIn ? `/api/rules/${editingRule.id}` : `/api/rules/custom/${editingRule.id}`)
        : '/api/rules/custom';
      const method = editingRule ? 'PUT' : 'POST';
      const payload = editingRule && isBuiltIn
        ? { ...data, type: editingRule.type }
        : data;
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await res.json();
      if (!res.ok) { setSaveError(result.error || t('saveFailed')); return false; }
      fetchRules();
      return true;
    } catch (err) {
      setSaveError(err.message);
      return false;
    }
  };

  const handleDelete = async (rule) => {
    if (!confirm(t('confirmDelete', { name: rule.name }))) return;
    await fetch(`/api/rules/custom/${rule.id}`, { method: 'DELETE' });
    fetchRules();
  };

  const handleRestore = async (rule) => {
    const res = await fetch(`/api/rules/${rule.id}/override?type=${rule.type}`, { method: 'DELETE' });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      setSaveError(result.error || t('saveFailed'));
      return false;
    }
    fetchRules();
    return true;
  };

  return { rules, loading, toggling, saveError, setSaveError, handleToggle, handleSave, handleDelete, handleRestore, fetchRules, totalPages, counts };
}
