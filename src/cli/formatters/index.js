import chalk from 'chalk';
import Table from 'cli-table3';

/**
 * Format a number with comma separators.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US');
}

/**
 * Format a token count in human-readable form (e.g., "2.84M tokens" or "12.3K tokens").
 * @param {number} n
 * @returns {string}
 */
export function formatTokens(n) {
  if (n == null || isNaN(n)) return '0 tokens';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M tokens`;
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K tokens`;
  }
  return `${n} tokens`;
}

/**
 * Estimate cost based on model pricing.
 * Uses approximate Claude pricing as default.
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {string} [model]
 * @returns {string}
 */
export function formatCost(inputTokens, outputTokens = 0, model = '') {
  // Approximate pricing per million tokens
  const pricing = {
    'claude-opus': { input: 15, output: 75 },
    'claude-sonnet': { input: 3, output: 15 },
    'claude-haiku': { input: 0.25, output: 1.25 },
    default: { input: 3, output: 15 },
  };

  let rates = pricing.default;
  for (const [key, value] of Object.entries(pricing)) {
    if (key !== 'default' && model.includes(key.replace('claude-', ''))) {
      rates = value;
      break;
    }
  }

  const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format health score as a colored bar chart display.
 * @param {Object} healthScore
 * @param {number} healthScore.score
 * @param {string} healthScore.grade
 * @param {string} healthScore.label
 * @param {Object} healthScore.breakdown
 * @param {string} healthScore.trend
 * @param {number} [healthScore.previousScore]
 * @returns {string}
 */
export function formatHealthScore(healthScore) {
  if (!healthScore) return chalk.gray('No health score available');

  const { score, grade, label, breakdown, trend, previousScore } = healthScore;

  const gradeColor = score >= 90 ? chalk.green
    : score >= 75 ? chalk.blue
    : score >= 60 ? chalk.yellow
    : score >= 40 ? chalk.hex('#FF8C00')
    : chalk.red;

  const trendArrow = trend === 'improving' ? chalk.green('↗')
    : trend === 'declining' ? chalk.red('↘')
    : chalk.gray('→');

  const trendText = previousScore != null
    ? ` ${trendArrow} ${trend === 'declining' ? '下降' : trend === 'improving' ? '上升' : '持平'} ${Math.abs(score - previousScore)} 分`
    : '';

  const lines = [];
  lines.push('');
  lines.push(`  Token 使用健康分：${gradeColor.bold(`${score} / 100`)}（${gradeColor(grade)} - ${label}）${trendText}`);
  lines.push(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  const categories = [
    { name: '浪费控制', value: breakdown.wasteRatio, max: 40 },
    { name: '缓存效率', value: breakdown.cacheEfficiency, max: 20 },
    { name: '模型匹配', value: breakdown.modelFit, max: 15 },
    { name: '会话卫生', value: breakdown.sessionHygiene, max: 15 },
    { name: '工具效率', value: breakdown.toolEfficiency, max: 10 },
  ];

  for (const cat of categories) {
    const bar = formatProgressBar(cat.value, cat.max, 12);
    const valueStr = `${String(cat.value).padStart(2)}/${cat.max}`;
    lines.push(`  ${cat.name}  ${bar}  ${valueStr}`);
  }

  lines.push(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  lines.push('');

  return lines.join('\n');
}

/**
 * Format severity with colored emoji prefix.
 * @param {string} severity - "high", "medium", or "low"
 * @returns {string}
 */
export function formatSeverity(severity) {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return chalk.red.bold('🔴 严重');
    case 'high':
      return chalk.red('🔴 高危');
    case 'medium':
      return chalk.yellow('🟡 中危');
    case 'low':
      return chalk.green('🟢 低危');
    default:
      return chalk.gray(`○ ${severity}`);
  }
}

/**
 * Format a date to a readable string.
 * @param {Date|number|string} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return '-';
  const d = date instanceof Date ? date : new Date(typeof date === 'number' ? date : date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a duration in milliseconds to human readable form.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

/**
 * Create a cli-table3 table.
 * @param {string[]} headers
 * @param {Array<string[]>} rows
 * @param {Object} [options]
 * @returns {string}
 */
export function createTable(headers, rows, options = {}) {
  const table = new Table({
    head: headers.map(h => chalk.cyan.bold(h)),
    style: { head: [], border: ['gray'] },
    ...options,
  });
  for (const row of rows) {
    table.push(row);
  }
  return table.toString();
}

/**
 * Format a progress bar.
 * @param {number} value
 * @param {number} max
 * @param {number} [width=20]
 * @returns {string}
 */
export function formatProgressBar(value, max, width = 20) {
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  const color = ratio >= 0.75 ? chalk.green
    : ratio >= 0.5 ? chalk.yellow
    : ratio >= 0.25 ? chalk.hex('#FF8C00')
    : chalk.red;

  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}
