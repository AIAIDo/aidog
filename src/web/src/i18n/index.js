import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enOverview from './locales/en/overview.json';
import enSessions from './locales/en/sessions.json';
import enAnalysis from './locales/en/analysis.json';
import enOptimize from './locales/en/optimize.json';
import enSecurity from './locales/en/security.json';
import enPerformance from './locales/en/performance.json';
import enSettings from './locales/en/settings.json';
import enRules from './locales/en/rules.json';
import enPlugins from './locales/en/plugins.json';

import zhCommon from './locales/zh-CN/common.json';
import zhOverview from './locales/zh-CN/overview.json';
import zhSessions from './locales/zh-CN/sessions.json';
import zhAnalysis from './locales/zh-CN/analysis.json';
import zhOptimize from './locales/zh-CN/optimize.json';
import zhSecurity from './locales/zh-CN/security.json';
import zhPerformance from './locales/zh-CN/performance.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhRules from './locales/zh-CN/rules.json';
import zhPlugins from './locales/zh-CN/plugins.json';

import jaCommon from './locales/ja/common.json';
import jaOverview from './locales/ja/overview.json';
import jaSessions from './locales/ja/sessions.json';
import jaAnalysis from './locales/ja/analysis.json';
import jaOptimize from './locales/ja/optimize.json';
import jaSecurity from './locales/ja/security.json';
import jaPerformance from './locales/ja/performance.json';
import jaSettings from './locales/ja/settings.json';
import jaRules from './locales/ja/rules.json';
import jaPlugins from './locales/ja/plugins.json';

const ns = ['common', 'overview', 'sessions', 'analysis', 'optimize', 'security', 'performance', 'settings', 'rules', 'plugins'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        overview: enOverview,
        sessions: enSessions,
        analysis: enAnalysis,
        optimize: enOptimize,
        security: enSecurity,
        performance: enPerformance,
        settings: enSettings,
        rules: enRules,
        plugins: enPlugins,
      },
      'zh-CN': {
        common: zhCommon,
        overview: zhOverview,
        sessions: zhSessions,
        analysis: zhAnalysis,
        optimize: zhOptimize,
        security: zhSecurity,
        performance: zhPerformance,
        settings: zhSettings,
        rules: zhRules,
        plugins: zhPlugins,
      },
      ja: {
        common: jaCommon,
        overview: jaOverview,
        sessions: jaSessions,
        analysis: jaAnalysis,
        optimize: jaOptimize,
        security: jaSecurity,
        performance: jaPerformance,
        settings: jaSettings,
        rules: jaRules,
        plugins: jaPlugins,
      },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'aidog-lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
