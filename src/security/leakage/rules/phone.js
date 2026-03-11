/** @type {import('../../types.js').SensitiveRule} */
export const phoneRule = {
  id: 'S1',
  name: '手机号',
  severity: 'medium',
  category: 'leakage',
  description: '检测中国大陆手机号码 (1[3-9]XXXXXXXXX)',
  builtIn: true,
  patterns: [/(?<!\d)1[3-9]\d{9}(?!\d)/g],
  mask(match) {
    return match.slice(0, 3) + '****' + match.slice(7);
  },
};
