import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Load custom security rules from ~/.aidog/config.json
 * @returns {import('../../types.js').SensitiveRule[]}
 */
export function loadCustomRules() {
  try {
    const configPath = join(homedir(), '.aidog', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const customRules = config?.security?.customRules || [];

    return customRules
      .map((rule) => {
        try {
          return {
            id: rule.id || `S_custom_${Math.random().toString(36).slice(2, 8)}`,
            name: rule.name || 'Custom Rule',
            severity: rule.severity || 'medium',
            category: 'leakage',
            description: rule.description || '用户自定义规则',
            builtIn: false,
            patterns: (rule.patterns || []).map((p) => new RegExp(p, 'g')),
            mask(match) {
              const len = rule.maskLength || 4;
              if (match.length <= len * 2) return '****';
              return match.slice(0, len) + '****' + match.slice(-len);
            },
          };
        } catch (err) {
          console.warn(`[security] Invalid custom rule "${rule.id || rule.name}": ${err.message}`);
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
