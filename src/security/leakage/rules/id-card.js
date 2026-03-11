function validateIdCard(id) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id[i]) * weights[i];
  }
  return checks[sum % 11] === id[17].toUpperCase();
}

/** @type {import('../../types.js').SensitiveRule} */
export const idCardRule = {
  id: 'S2',
  name: '身份证号',
  severity: 'critical',
  category: 'leakage',
  description: '检测中国大陆身份证号码（18位，含校验位验证）',
  builtIn: true,
  patterns: [/(?<!\d)\d{17}[\dXx](?!\d)/g],
  mask(match) {
    return match.slice(0, 6) + '****' + match.slice(14);
  },
  // Override: post-validate with checksum
  validate(match) {
    return validateIdCard(match);
  },
};
