import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch, useApi } from '../hooks/useApi.js';

function SettingSection({ title, children }) {
  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-medium text-slate-300 pb-2 border-b border-surface-700">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1">
        <p className="text-sm text-slate-300">{label}</p>
        {description && <p className="text-xs text-slate-600 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0 w-72">{children}</div>
    </div>
  );
}

function StatusBadge({ available, source }) {
  const { t } = useTranslation('settings');
  if (available) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-green-400">{t('provider.available')}</span>
        {source && <span className="text-slate-600 ml-1">{t('provider.viaSource', { source })}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="w-2 h-2 rounded-full bg-slate-600" />
      <span className="text-slate-500">{t('provider.notDetected')}</span>
    </span>
  );
}

function ProviderConfigPanel({ provider, providerConfigs, onUpdate }) {
  const { t } = useTranslation('settings');
  const cfg = providerConfigs?.[provider.name] || {};
  const needsApiKey = provider.name !== 'ollama';
  const needsBaseURL = ['ollama', 'compatible', 'kimi', 'glm', 'minmax', 'qoder'].includes(provider.name);
  const hasCfg = !!(cfg.apiKey || cfg.baseURL || cfg.model);

  return (
    <div className="mt-1 mb-2 ml-2 pl-3 border-l-2 border-primary-500/30 space-y-3 py-3 pr-3 bg-surface-900/50 rounded-r-md">
      <p className="text-xs font-medium text-slate-400">
        {provider.displayName} {t('provider.configuration')}
      </p>

      {needsApiKey && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t('provider.apiKey')}</label>
          <input
            type="password"
            value={cfg.apiKey || ''}
            onChange={(e) => onUpdate(provider.name, 'apiKey', e.target.value)}
            placeholder={provider.available && !cfg.apiKey ? t('provider.usingAutoDetectedKey') : 'sk-...'}
            className="input-field text-sm font-mono w-full"
          />
          <p className="text-[10px] text-slate-600 mt-1">{t('provider.storedLocallyOnly')}</p>
        </div>
      )}

      {needsBaseURL && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t('provider.baseURL')}</label>
          <input
            type="text"
            value={cfg.baseURL || ''}
            onChange={(e) => onUpdate(provider.name, 'baseURL', e.target.value)}
            placeholder={provider.name === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
            className="input-field text-sm font-mono w-full"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-500 mb-1">{t('provider.customModel')}</label>
        <input
          type="text"
          value={cfg.model || ''}
          onChange={(e) => onUpdate(provider.name, 'model', e.target.value)}
          placeholder={provider.models?.[0] || 'model-name'}
          className="input-field text-sm font-mono w-full"
        />
        {provider.models?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {provider.models.map((m) => (
              <button
                key={m}
                onClick={() => onUpdate(provider.name, 'model', m)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
                  cfg.model === m
                    ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                    : 'bg-surface-700 text-slate-500 hover:text-slate-300 hover:bg-surface-600'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasCfg && (
        <button
          onClick={() => {
            onUpdate(provider.name, 'apiKey', '');
            onUpdate(provider.name, 'baseURL', '');
            onUpdate(provider.name, 'model', '');
          }}
          className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
        >
          {t('provider.clearManualConfig')}
        </button>
      )}
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation('settings');
  const { data: discovery, loading: discovering } = useFetch('/api/config/discover');
  const { data: settingsData } = useFetch('/api/settings');
  const { data: countryData } = useFetch('/api/security/country-defaults');
  const { execute: saveSettings, loading: saving } = useApi('/api/settings', { method: 'PUT' });
  const [saved, setSaved] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState(null);
  const [regexErrors, setRegexErrors] = useState({});

  const [config, setConfig] = useState({
    aiProvider: 'auto',
    aiModel: '',
    providerConfigs: {},
    alertThreshold: 80,
    dataPath: '~/.aidog/data',
    analysisInterval: 300,
    maxSessionAge: 30,
    autoAnalyze: true,
    securityCountry: 'CN',
    securityRuleOverrides: null,
  });

  useEffect(() => {
    if (settingsData && Object.keys(settingsData).length > 0) {
      setConfig((prev) => ({ ...prev, ...settingsData }));
    }
  }, [settingsData]);

  // When discovery completes and no saved provider, auto-select the recommended one
  useEffect(() => {
    if (discovery?.recommended && config.aiProvider === 'auto' && !config.aiModel) {
      const rec = discovery.providers.find((p) => p.name === discovery.recommended);
      if (rec?.models?.length) {
        setConfig((prev) => ({ ...prev, aiModel: rec.models[0] }));
      }
    }
  }, [discovery]);

  const updateField = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const updateProviderConfig = (providerName, key, value) => {
    setConfig((prev) => ({
      ...prev,
      providerConfigs: {
        ...prev.providerConfigs,
        [providerName]: {
          ...(prev.providerConfigs?.[providerName] || {}),
          [key]: value,
        },
      },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      await saveSettings({ body: JSON.stringify(config) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // Error handled by useApi
    }
  };

  const providers = discovery?.providers || [];
  const selectedProvider = config.aiProvider === 'auto'
    ? providers.find((p) => p.available)
    : providers.find((p) => p.name === config.aiProvider);
  const availableModels = selectedProvider?.models || [];

  const countries = countryData?.countries || [];
  const currentCountry = countries.find((c) => c.code === (config.securityCountry || 'CN'));

  const getPatternValue = (ruleId) => {
    const override = config.securityRuleOverrides?.[ruleId];
    if (override?.patterns?.[0]) return override.patterns[0];
    if (!currentCountry) return '';
    return ruleId === 'S1' ? currentCountry.phone.patterns[0] : currentCountry.idCard.patterns[0];
  };

  const isPatternCustomized = (ruleId) => {
    return !!(config.securityRuleOverrides?.[ruleId]?.patterns?.[0]);
  };

  const updateRuleOverride = (ruleId, pattern) => {
    // Validate regex
    try {
      new RegExp(pattern, 'g');
      setRegexErrors((prev) => ({ ...prev, [ruleId]: null }));
    } catch (e) {
      setRegexErrors((prev) => ({ ...prev, [ruleId]: e.message }));
    }

    setConfig((prev) => ({
      ...prev,
      securityRuleOverrides: {
        ...(prev.securityRuleOverrides || {}),
        [ruleId]: {
          ...(prev.securityRuleOverrides?.[ruleId] || {}),
          patterns: [pattern],
        },
      },
    }));
    setSaved(false);
  };

  const handleRestoreDefaults = () => {
    setConfig((prev) => ({ ...prev, securityRuleOverrides: null }));
    setRegexErrors({});
    setSaved(false);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* AI Provider — Auto Discovery + Manual Config */}
      <SettingSection title={t('sections.aiProvider')}>
        {/* Discovery status card */}
        <div className="rounded-lg bg-surface-900/50 border border-surface-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              {t('provider.providers')}
            </p>
            {discovering && (
              <span className="text-xs text-slate-500 animate-pulse">{t('provider.scanning')}</span>
            )}
            {!discovering && providers.filter((p) => p.available).length > 0 && (
              <span className="text-xs text-green-400">
                {t('provider.providersReady', { count: providers.filter((p) => p.available).length })}
              </span>
            )}
          </div>
          {providers.length > 0 ? (
            <div className="grid gap-2">
              {providers.map((p) => {
                const manualCfg = config.providerConfigs?.[p.name];
                const isManuallyConfigured = !!(manualCfg?.apiKey || manualCfg?.baseURL);
                const isEffectivelyAvailable = p.available || isManuallyConfigured;
                const isSelected = config.aiProvider === p.name ||
                  (config.aiProvider === 'auto' && p.name === discovery?.recommended);
                const isExpanded = expandedProvider === p.name;

                return (
                  <div key={p.name}>
                    <div
                      className={`flex items-center justify-between py-2 px-3 rounded-md transition-colors cursor-pointer ${
                        isSelected && isEffectivelyAvailable
                          ? 'bg-primary-500/10 border border-primary-500/30'
                          : isManuallyConfigured
                            ? 'bg-surface-800/50 border border-purple-500/20 hover:bg-surface-700/50'
                            : p.available
                              ? 'bg-surface-800/50 hover:bg-surface-700/50'
                              : 'bg-surface-800/30 hover:bg-surface-700/30'
                      }`}
                      onClick={() => {
                        updateField('aiProvider', p.name);
                        const model = manualCfg?.model || p.models?.[0] || '';
                        updateField('aiModel', model);
                        setExpandedProvider(isExpanded ? null : p.name);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${isEffectivelyAvailable ? 'text-slate-200' : 'text-slate-500'}`}>
                          {p.displayName}
                        </span>
                        {p.isLocal && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                            LOCAL
                          </span>
                        )}
                        {isManuallyConfigured && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                            MANUAL
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge
                          available={isEffectivelyAvailable}
                          source={isManuallyConfigured && !p.available ? 'manual config' : p.source}
                        />
                        {isSelected && isEffectivelyAvailable && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 font-medium">
                            {t('provider.selected')}
                          </span>
                        )}
                        {!isEffectivelyAvailable && (
                          <span className="text-[10px] text-slate-500">{t('provider.clickToConfigure')}</span>
                        )}
                        <svg
                          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>

                    {isExpanded && (
                      <ProviderConfigPanel
                        provider={p}
                        providerConfigs={config.providerConfigs}
                        onUpdate={updateProviderConfig}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : !discovering ? (
            <p className="text-xs text-slate-500">
              {t('provider.noProvidersDetected')}
            </p>
          ) : null}
          {discovery?.hasAwsBedrock && (
            <p className="text-xs text-slate-500 mt-1">{t('provider.awsBedrockDetected')}</p>
          )}
        </div>

        {/* Provider override dropdown */}
        <SettingRow label={t('provider.provider')} description={t('provider.providerDesc')}>
          <select
            value={config.aiProvider}
            onChange={(e) => {
              const val = e.target.value;
              updateField('aiProvider', val);
              if (val === 'auto') {
                const rec = providers.find((x) => x.available);
                if (rec?.models?.length) updateField('aiModel', rec.models[0]);
              } else {
                const p = providers.find((x) => x.name === val);
                const manualCfg = config.providerConfigs?.[val];
                const model = manualCfg?.model || p?.models?.[0] || '';
                updateField('aiModel', model);
                // Auto-expand config panel for manual setup
                setExpandedProvider(val);
              }
            }}
            className="select-field text-sm"
          >
            <option value="auto">
              {t('provider.autoDetect')}{discovery?.recommended ? ` (${discovery.recommended})` : ''}
            </option>
            {providers.map((p) => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))
            }
          </select>
        </SettingRow>

        {/* Model selection — text input with preset buttons */}
        <SettingRow label={t('provider.model')} description={t('provider.modelDesc')}>
          <div className="space-y-2">
            <input
              type="text"
              value={config.aiModel}
              onChange={(e) => updateField('aiModel', e.target.value)}
              placeholder={availableModels[0] || 'model-name'}
              className="input-field text-sm font-mono w-full"
            />
            {availableModels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {availableModels.map((m) => (
                  <button
                    key={m}
                    onClick={() => updateField('aiModel', m)}
                    className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
                      config.aiModel === m
                        ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                        : 'bg-surface-700 text-slate-500 hover:text-slate-300 hover:bg-surface-600'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </SettingRow>
      </SettingSection>

      {/* Alert Thresholds */}
      <SettingSection title={t('sections.alerts')}>
        <SettingRow
          label={t('alerts.healthScoreThreshold')}
          description={t('alerts.healthScoreThresholdDesc')}
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              value={config.alertThreshold}
              onChange={(e) => updateField('alertThreshold', parseInt(e.target.value))}
              className="flex-1 accent-primary-500"
            />
            <span className="font-mono text-sm text-primary-400 w-8 text-right">
              {config.alertThreshold}
            </span>
          </div>
        </SettingRow>
      </SettingSection>

      {/* Security Rules — Country + Pattern Editing */}
      <SettingSection title={t('sections.securityRules')}>
        <SettingRow
          label={t('security.countryRegion')}
          description={t('security.countryRegionDesc')}
        >
          <select
            value={config.securityCountry || 'CN'}
            onChange={(e) => {
              updateField('securityCountry', e.target.value);
              updateField('securityRuleOverrides', null);
              setRegexErrors({});
            }}
            className="select-field text-sm"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
            {countries.length === 0 && <option value="CN">中国 (China)</option>}
          </select>
        </SettingRow>

        <SettingRow
          label={t('security.phoneNumberPattern')}
          description={currentCountry?.phone?.description || t('security.phoneNumberPatternDesc')}
        >
          <div className="space-y-1">
            <div className="relative">
              <input
                type="text"
                value={getPatternValue('S1')}
                onChange={(e) => updateRuleOverride('S1', e.target.value)}
                className={`input-field text-sm font-mono w-full ${regexErrors.S1 ? 'border-red-500/50' : ''} ${isPatternCustomized('S1') ? 'border-purple-500/30' : ''}`}
              />
              {isPatternCustomized('S1') && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                  {t('security.customized')}
                </span>
              )}
            </div>
            {regexErrors.S1 && (
              <p className="text-[10px] text-red-400">{regexErrors.S1}</p>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label={t('security.idCardPattern')}
          description={currentCountry?.idCard?.description || t('security.idCardPatternDesc')}
        >
          <div className="space-y-1">
            <div className="relative">
              <input
                type="text"
                value={getPatternValue('S2')}
                onChange={(e) => updateRuleOverride('S2', e.target.value)}
                className={`input-field text-sm font-mono w-full ${regexErrors.S2 ? 'border-red-500/50' : ''} ${isPatternCustomized('S2') ? 'border-purple-500/30' : ''}`}
              />
              {isPatternCustomized('S2') && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                  {t('security.customized')}
                </span>
              )}
            </div>
            {regexErrors.S2 && (
              <p className="text-[10px] text-red-400">{regexErrors.S2}</p>
            )}
          </div>
        </SettingRow>

        {isPatternCustomized('S1') || isPatternCustomized('S2') ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleRestoreDefaults}
              className="text-xs text-primary-400 hover:text-primary-300 transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {t('security.restoreCountryDefaults')}
            </button>
          </div>
        ) : null}
      </SettingSection>

      {/* Analysis Settings */}
      <SettingSection title={t('sections.analysis')}>
        <SettingRow
          label={t('analysis.analysisInterval')}
          description={t('analysis.analysisIntervalDesc')}
        >
          <select
            value={config.analysisInterval}
            onChange={(e) => updateField('analysisInterval', parseInt(e.target.value))}
            className="select-field text-sm"
          >
            <option value={60}>{t('intervalOptions.1min')}</option>
            <option value={300}>{t('intervalOptions.5min')}</option>
            <option value={600}>{t('intervalOptions.10min')}</option>
            <option value={1800}>{t('intervalOptions.30min')}</option>
            <option value={3600}>{t('intervalOptions.1hour')}</option>
          </select>
        </SettingRow>

        <SettingRow
          label={t('analysis.autoAnalyze')}
          description={t('analysis.autoAnalyzeDesc')}
        >
          <button
            onClick={() => updateField('autoAnalyze', !config.autoAnalyze)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
              config.autoAnalyze ? 'bg-primary-500' : 'bg-surface-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                config.autoAnalyze ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </SettingRow>

        <SettingRow
          label={t('analysis.maxSessionAge')}
          description={t('analysis.maxSessionAgeDesc')}
        >
          <select
            value={config.maxSessionAge}
            onChange={(e) => updateField('maxSessionAge', parseInt(e.target.value))}
            className="select-field text-sm"
          >
            <option value={7}>{t('retentionOptions.7days')}</option>
            <option value={14}>{t('retentionOptions.14days')}</option>
            <option value={30}>{t('retentionOptions.30days')}</option>
            <option value={60}>{t('retentionOptions.60days')}</option>
            <option value={90}>{t('retentionOptions.90days')}</option>
          </select>
        </SettingRow>
      </SettingSection>

      {/* Data Path */}
      <SettingSection title={t('sections.storage')}>
        <SettingRow label={t('storage.dataPath')} description={t('storage.dataPathDesc')}>
          <input
            type="text"
            value={config.dataPath}
            onChange={(e) => updateField('dataPath', e.target.value)}
            className="input-field text-sm font-mono"
          />
        </SettingRow>
      </SettingSection>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`btn-primary ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {saving ? t('status.saving', { ns: 'common' }) : t('saveSettings')}
        </button>
        {saved && (
          <span className="text-sm text-green-400 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {t('status.saved', { ns: 'common' })}
          </span>
        )}
      </div>
    </div>
  );
}
