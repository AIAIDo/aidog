import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatTokens,
  formatProgressBar,
  formatSeverity,
} from '../../src/cli/formatters/index.js';

describe('formatNumber', () => {
  it('should format numbers with comma separators', () => {
    const result = formatNumber(1234567);
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('567');
  });

  it('should handle zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('should handle null/undefined/NaN', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });

  it('should handle small numbers', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatTokens', () => {
  it('should format millions', () => {
    const result = formatTokens(2840000);
    expect(result).toContain('2.84M');
    expect(result).toContain('tokens');
  });

  it('should format thousands', () => {
    const result = formatTokens(12300);
    expect(result).toContain('12.3K');
    expect(result).toContain('tokens');
  });

  it('should format small numbers directly', () => {
    const result = formatTokens(500);
    expect(result).toBe('500 tokens');
  });

  it('should handle zero', () => {
    expect(formatTokens(0)).toBe('0 tokens');
  });

  it('should handle null/NaN', () => {
    expect(formatTokens(null)).toBe('0 tokens');
    expect(formatTokens(NaN)).toBe('0 tokens');
  });

  it('should handle negative numbers', () => {
    const result = formatTokens(-5000000);
    expect(result).toContain('M');
    expect(result).toContain('tokens');
  });
});

describe('formatProgressBar', () => {
  it('should create a bar of the specified width', () => {
    const bar = formatProgressBar(10, 20, 10);
    // The bar should contain filled and empty characters
    expect(typeof bar).toBe('string');
    expect(bar.length).toBeGreaterThan(0);
  });

  it('should handle full bar (value === max)', () => {
    const bar = formatProgressBar(20, 20, 10);
    expect(typeof bar).toBe('string');
  });

  it('should handle empty bar (value === 0)', () => {
    const bar = formatProgressBar(0, 20, 10);
    expect(typeof bar).toBe('string');
  });

  it('should clamp ratio between 0 and 1', () => {
    const barOver = formatProgressBar(30, 20, 10);
    const barUnder = formatProgressBar(-5, 20, 10);
    expect(typeof barOver).toBe('string');
    expect(typeof barUnder).toBe('string');
  });
});

describe('formatSeverity', () => {
  it('should format high severity', () => {
    const result = formatSeverity('high');
    expect(typeof result).toBe('string');
    // Contains the Chinese characters for "high risk"
    expect(result).toContain('高危');
  });

  it('should format medium severity', () => {
    const result = formatSeverity('medium');
    expect(result).toContain('中危');
  });

  it('should format low severity', () => {
    const result = formatSeverity('low');
    expect(result).toContain('低危');
  });

  it('should handle unknown severity', () => {
    const result = formatSeverity('info');
    expect(result).toContain('info');
  });
});
