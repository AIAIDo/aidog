function luhnCheck(num) {
  let sum = 0;
  let alternate = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/** @type {import('../../types.js').SensitiveRule} */
export const bankCardRule = {
  id: 'S3',
  name: '银行卡号',
  severity: 'critical',
  category: 'leakage',
  description: '检测银行卡号（16-19位数字，Luhn校验）',
  builtIn: true,
  patterns: [/(?<!\d)[3-6]\d{15,18}(?!\d)/g],
  mask(match) {
    return match.slice(0, 4) + '****' + match.slice(-4);
  },
  validate(match) {
    return luhnCheck(match);
  },
};
