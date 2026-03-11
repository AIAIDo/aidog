/** @type {import('../../types.js').SensitiveRule} */
export const passwordRule = {
  id: 'S4',
  name: '密码模式',
  severity: 'high',
  category: 'leakage',
  description: '检测明文密码（password=xxx, -p xxx 等模式）',
  builtIn: true,
  patterns: [
    /(?:password|passwd|pwd|pass)\s*[=:]\s*['"]?(\S{4,})['"]?/gi,
    /(?:--password|--passwd|-p)\s+['"]?(\S{4,})['"]?/gi,
  ],
  mask(match) {
    // Replace the password value part with ****
    return match.replace(/([=:]\s*['"]?)(\S{4,})(['"]?)/, '$1****$3')
               .replace(/((?:--password|--passwd|-p)\s+['"]?)(\S{4,})(['"]?)/, '$1****$3');
  },
};
