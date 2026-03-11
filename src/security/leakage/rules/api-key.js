/** @type {import('../../types.js').SensitiveRule} */
export const apiKeyRule = {
  id: 'S7',
  name: 'API Key / Token',
  severity: 'high',
  category: 'leakage',
  description: '检测常见 API Key 和 Token 格式',
  builtIn: true,
  patterns: [
    /(?<![a-zA-Z0-9])sk-[a-zA-Z0-9]{20,}/g,           // OpenAI / Anthropic
    /(?<![a-zA-Z0-9])ghp_[a-zA-Z0-9]{36}/g,            // GitHub PAT
    /(?<![a-zA-Z0-9])gho_[a-zA-Z0-9]{36}/g,            // GitHub OAuth
    /(?<![a-zA-Z0-9])github_pat_[a-zA-Z0-9_]{20,}/g,  // GitHub fine-grained PAT
    /(?<![a-zA-Z0-9])AKIA[0-9A-Z]{16}/g,               // AWS Access Key
    /(?<![a-zA-Z0-9])xox[baprs]-[a-zA-Z0-9\-]+/g,      // Slack
    /(?<![a-zA-Z0-9])glpat-[a-zA-Z0-9_\-]{20,}/g,      // GitLab PAT
  ],
  mask(match) {
    if (match.length <= 8) return match.slice(0, 3) + '...';
    return match.slice(0, 4) + '...' + match.slice(-4);
  },
};
