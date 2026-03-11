import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch, useApi } from '../hooks/useApi.js';

function PluginCard({ plugin, onToggle, toggling }) {
  const { t } = useTranslation('plugins');
  const isEnabled = plugin.enabled;
  const isAvailable = plugin.available !== false;

  return (
    <div className={`card-hover ${!isAvailable ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium text-slate-200 truncate">{plugin.name}</h3>
            {plugin.version && (
              <span className="font-mono text-[10px] text-slate-600">v{plugin.version}</span>
            )}
          </div>

          {plugin.description && (
            <p className="text-xs text-slate-500 line-clamp-2">{plugin.description}</p>
          )}

          <div className="flex items-center gap-3 mt-3">
            {/* Status badges */}
            <span
              className={`badge text-[10px] ${
                isAvailable
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
              }`}
            >
              {isAvailable ? t('available') : t('unavailable')}
            </span>
            <span
              className={`badge text-[10px] ${
                isEnabled
                  ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                  : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
              }`}
            >
              {isEnabled ? t('enabled') : t('disabled')}
            </span>
          </div>
        </div>

        {/* Toggle */}
        <div className="shrink-0">
          <button
            onClick={() => onToggle(plugin)}
            disabled={!isAvailable || toggling === plugin.id}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
              !isAvailable
                ? 'bg-surface-700 cursor-not-allowed'
                : isEnabled
                ? 'bg-primary-500'
                : 'bg-surface-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Plugin info footer */}
      <div className="mt-3 pt-3 border-t border-surface-700/50 flex items-center gap-4 text-xs text-slate-600">
        {plugin.author && <span>{t('by', { author: plugin.author })}</span>}
        {plugin.homepage && (
          <a
            href={plugin.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-500/60 hover:text-primary-400 transition-colors"
          >
            {t('homepage')} &rarr;
          </a>
        )}
      </div>
    </div>
  );
}

export default function Plugins() {
  const { t } = useTranslation('plugins');
  const { data: pluginsData, loading } = useFetch('/api/plugins');
  const { execute: togglePlugin } = useApi('/api/plugins/toggle', { method: 'POST' });
  const [toggling, setToggling] = useState(null);
  const [localPlugins, setLocalPlugins] = useState(null);

  const plugins = localPlugins ?? pluginsData?.plugins ?? [
    {
      id: 'context-dedup',
      name: 'Context Deduplication',
      description: 'Detects and flags repeated context blocks across conversation turns.',
      version: '1.0.2',
      author: 'aidog',
      homepage: 'https://github.com/anthropics/aidog-plugin-dedup',
      available: true,
      enabled: true,
    },
    {
      id: 'tool-loop-detect',
      name: 'Tool Loop Detection',
      description: 'Identifies patterns of repeated failed tool calls.',
      version: '1.0.0',
      author: 'aidog',
      homepage: 'https://github.com/anthropics/aidog-plugin-toolloop',
      available: true,
      enabled: true,
    },
    {
      id: 'verbose-check',
      name: 'Verbosity Checker',
      description: 'Analyzes assistant output length relative to task complexity.',
      version: '0.9.1',
      author: 'aidog',
      homepage: null,
      available: true,
      enabled: false,
    },
    {
      id: 'cost-tracker',
      name: 'Cost Tracker',
      description: 'Tracks real-time cost estimation based on model pricing.',
      version: '1.1.0',
      author: 'community',
      homepage: 'https://github.com/example/aidog-cost-tracker',
      available: true,
      enabled: false,
    },
    {
      id: 'custom-rules',
      name: 'Custom Rules Engine',
      description: 'Define custom token analysis rules using a YAML DSL.',
      version: '0.5.0',
      author: 'community',
      homepage: null,
      available: false,
      enabled: false,
    },
  ];

  const handleToggle = useCallback(async (plugin) => {
    setToggling(plugin.id);
    try {
      await togglePlugin({
        body: JSON.stringify({ pluginId: plugin.id, enabled: !plugin.enabled }),
      });
      setLocalPlugins((prev) => {
        const list = prev || plugins;
        return list.map((p) =>
          p.id === plugin.id ? { ...p, enabled: !p.enabled } : p
        );
      });
    } catch {
      // Error handled by useApi
    } finally {
      setToggling(null);
    }
  }, [plugins, togglePlugin]);

  const enabledCount = plugins.filter((p) => p.enabled).length;
  const availableCount = plugins.filter((p) => p.available !== false).length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{t('totalPlugins')}</p>
          <p className="font-mono text-2xl font-bold text-primary-400">{plugins.length}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{t('available')}</p>
          <p className="font-mono text-2xl font-bold text-green-400">{availableCount}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{t('enabled')}</p>
          <p className="font-mono text-2xl font-bold text-primary-400">{enabledCount}</p>
        </div>
      </div>

      {/* Plugin list */}
      {loading ? (
        <div className="card text-center py-12">
          <p className="text-slate-500">{t('loadingPlugins')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onToggle={handleToggle}
              toggling={toggling}
            />
          ))}
        </div>
      )}
    </div>
  );
}
