/**
 * Country-specific default patterns for phone numbers and ID cards.
 */

export const countryDefaults = {
  CN: {
    phone: {
      patterns: ['(?<!\\d)1[3-9]\\d{9}(?!\\d)'],
      description: '检测中国大陆手机号码 (1[3-9]XXXXXXXXX)',
      mask: { prefix: 3, suffix: 4 },
    },
    idCard: {
      patterns: ['(?<!\\d)\\d{17}[\\dXx](?!\\d)'],
      description: '检测中国大陆身份证号码（18位，含校验位验证）',
      mask: { prefix: 6, suffix: 4 },
      hasChecksum: true,
    },
  },
  US: {
    phone: {
      patterns: ['(?<!\\d)(?:\\+?1[-.\\s]?)?\\(?[2-9]\\d{2}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}(?!\\d)'],
      description: 'Detect US phone numbers ((xxx) xxx-xxxx)',
      mask: { prefix: 3, suffix: 4 },
    },
    idCard: {
      patterns: ['(?<!\\d)\\d{3}[-.\\s]?\\d{2}[-.\\s]?\\d{4}(?!\\d)'],
      description: 'Detect US Social Security Numbers (xxx-xx-xxxx)',
      mask: { prefix: 3, suffix: 2 },
      hasChecksum: false,
    },
  },
  JP: {
    phone: {
      patterns: ['(?<!\\d)0[789]0[-.\\s]?\\d{4}[-.\\s]?\\d{4}(?!\\d)'],
      description: '日本の携帯電話番号を検出 (0x0-xxxx-xxxx)',
      mask: { prefix: 3, suffix: 4 },
    },
    idCard: {
      patterns: ['(?<!\\d)\\d{4}[-.\\s]?\\d{4}[-.\\s]?\\d{4}(?!\\d)'],
      description: 'Detect Japan My Number (12 digits)',
      mask: { prefix: 4, suffix: 4 },
      hasChecksum: false,
    },
  },
};

export const countryList = [
  { code: 'CN', label: '中国 (China)' },
  { code: 'US', label: 'United States' },
  { code: 'JP', label: '日本 (Japan)' },
];

/**
 * Get default patterns for a country code.
 * @param {string} countryCode
 * @returns {{ phone: object, idCard: object } | null}
 */
export function getCountryDefaults(countryCode) {
  return countryDefaults[countryCode] || null;
}
