/** @type {import('../../types.js').SensitiveRule} */
export const ipCredentialRule = {
  id: 'S8',
  name: 'IP+凭据组合',
  severity: 'high',
  category: 'leakage',
  description: '检测 IP 地址与密码/凭据的组合',
  builtIn: true,
  patterns: [
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b.*(?:password|passwd|pwd)\s*[=:]\s*\S+/gi,
  ],
  mask(match) {
    // Mask the IP and password
    return match
      .replace(/(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})/, '$1.*.*.$2')
      .replace(/((?:password|passwd|pwd)\s*[=:]\s*)\S+/i, '$1****');
  },
};
