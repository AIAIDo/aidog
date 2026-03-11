/** @type {import('../../types.js').SensitiveRule} */
export const serverLoginRule = {
  id: 'S5',
  name: '服务器登录凭据',
  severity: 'high',
  category: 'leakage',
  description: '检测 SSH/SCP/MySQL 等登录命令中的凭据',
  builtIn: true,
  patterns: [
    /ssh\s+\w+@[\w.\-]+/gi,
    /scp\s+.*\w+@[\w.\-]+/gi,
    /mysql\s+-u\s*\S+\s+-p\S*/gi,
  ],
  mask(match) {
    return match.replace(/(\w+)@/, '****@')
               .replace(/(-u\s*)\S+/, '$1****')
               .replace(/(-p)\S+/, '$1****');
  },
};
