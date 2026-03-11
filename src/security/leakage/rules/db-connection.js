/** @type {import('../../types.js').SensitiveRule} */
export const dbConnectionRule = {
  id: 'S6',
  name: '数据库连接串',
  severity: 'critical',
  category: 'leakage',
  description: '检测数据库连接字符串中的明文密码',
  builtIn: true,
  patterns: [
    /(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
  ],
  mask(match) {
    return match.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
  },
};
