/** @type {import('../../types.js').SensitiveRule} */
export const emailRule = {
  id: 'S9',
  name: '邮箱地址',
  severity: 'low',
  category: 'leakage',
  description: '检测邮箱地址',
  builtIn: true,
  patterns: [
    /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  ],
  mask(match) {
    const [local, domain] = match.split('@');
    return local[0] + '***@' + domain;
  },
};
