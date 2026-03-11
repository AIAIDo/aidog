import chalk from 'chalk';
import ora from 'ora';
import { formatNumber, formatTokens, createTable, formatDuration, formatProgressBar } from '../formatters/index.js';

/**
 * Register the `aidog performance` command (alias: perf).
 * @param {import('commander').Command} program
 */
export function registerPerformanceCommand(program) {
  const perf = program
    .command('performance')
    .alias('perf')
    .description('性能分析 — 效率、质量与成本 KPI');

  perf
    .command('analyze')
    .description('运行性能分析（计算 + 保存快照）')
    .option('--days <n>', '分析天数', '7')
    .option('--json', 'JSON 输出')
    .action(async (options) => {
      await runAnalyze(options);
    });

  perf
    .command('overview')
    .description('概览 KPI')
    .option('--days <n>', '分析天数', '7')
    .option('--json', 'JSON 输出')
    .action(async (options) => {
      await runOverview(options);
    });

  perf
    .command('agents')
    .description('代理对比')
    .option('--days <n>', '分析天数', '7')
    .option('--json', 'JSON 输出')
    .action(async (options) => {
      await runAgents(options);
    });

  perf
    .command('tools')
    .description('工具调用分析')
    .option('--days <n>', '分析天数', '7')
    .option('--json', 'JSON 输出')
    .action(async (options) => {
      await runTools(options);
    });

  perf
    .command('cost')
    .description('成本估算')
    .option('--days <n>', '分析天数', '7')
    .option('--json', 'JSON 输出')
    .action(async (options) => {
      await runCost(options);
    });

  perf
    .command('history')
    .description('评分趋势')
    .option('--days <n>', '查看天数', '30')
    .option('--json', 'JSON 输出')
    .action(async (options) => {
      await runHistory(options);
    });
}

async function createEngine() {
  const { SQLiteStorage } = await import('../../storage/sqlite.js');
  const { PerformanceEngine } = await import('../../performance/index.js');
  const storage = new SQLiteStorage();
  return { engine: new PerformanceEngine({ storage }), storage };
}

async function runAnalyze(options) {
  const spinner = ora('加载性能模块...').start();
  try {
    const { engine, storage } = await createEngine();
    const days = parseInt(options.days, 10);

    spinner.text = '正在分析...';
    const result = await engine.analyze({ days });

    // Save snapshot
    if (result.score) {
      storage.savePerformanceSnapshot({
        snapshotType: 'full',
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        metrics: result.metrics,
        score: result.score,
      });
    }

    spinner.succeed('分析完成');

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printPerformanceScore(result.score);
    printMetricsSummary(result.metrics);

    storage.close();
  } catch (err) {
    spinner.fail(`分析失败: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runOverview(options) {
  const spinner = ora('计算 KPI...').start();
  try {
    const { engine, storage } = await createEngine();
    const days = parseInt(options.days, 10);
    const result = await engine.analyze({ days });

    spinner.succeed('计算完成');

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printPerformanceScore(result.score);
    printMetricsSummary(result.metrics);

    storage.close();
  } catch (err) {
    spinner.fail(`失败: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAgents(options) {
  const spinner = ora('计算代理对比...').start();
  try {
    const { engine, storage } = await createEngine();
    const days = parseInt(options.days, 10);
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = engine.storage.queryByDateRange(start, end);
    const agents = engine.computeAgentComparison(events);

    spinner.succeed('计算完成');

    if (options.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }

    if (agents.length === 0) {
      console.log(chalk.gray('\n  暂无代理数据\n'));
      return;
    }

    console.log(chalk.bold('\n  代理对比\n'));
    const rows = agents.map(a => [
      a.agent,
      formatNumber(a.sessionCount),
      formatTokens(a.totalTokens),
      `$${a.totalCost.toFixed(4)}`,
      `${(a.cacheEfficiency * 100).toFixed(1)}%`,
    ]);
    console.log(createTable(['代理', '会话数', '总 Token', '估算成本', '缓存命中率'], rows));

    storage.close();
  } catch (err) {
    spinner.fail(`失败: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runTools(options) {
  const spinner = ora('计算工具分析...').start();
  try {
    const { engine, storage } = await createEngine();
    const days = parseInt(options.days, 10);
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = engine.storage.queryByDateRange(start, end);
    const tools = engine.computeToolMetrics(events);

    spinner.succeed('计算完成');

    if (options.json) {
      console.log(JSON.stringify(tools, null, 2));
      return;
    }

    console.log(chalk.bold('\n  工具调用分析\n'));
    console.log(`  总调用数：${formatNumber(tools.totalCalls)}`);
    console.log(`  总错误数：${formatNumber(tools.totalErrors)}`);
    console.log(`  成功率：${(tools.overallSuccessRate * 100).toFixed(1)}%`);
    console.log(`  工具种类：${tools.uniqueTools}`);

    if (tools.topByCount.length > 0) {
      console.log(chalk.bold('\n  Top 10 工具（按调用次数）\n'));
      const rows = tools.topByCount.map(t => [
        t.name,
        formatNumber(t.count),
        formatNumber(t.avgInputSize),
        formatNumber(t.avgOutputSize),
        `${(t.successRate * 100).toFixed(0)}%`,
      ]);
      console.log(createTable(['工具', '调用次数', '平均输入', '平均输出', '成功率'], rows));
    }

    storage.close();
  } catch (err) {
    spinner.fail(`失败: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runCost(options) {
  const spinner = ora('计算成本...').start();
  try {
    const { engine, storage } = await createEngine();
    const days = parseInt(options.days, 10);
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = engine.storage.queryByDateRange(start, end);
    const cost = engine.computeCostSummary(events);

    spinner.succeed('计算完成');

    if (options.json) {
      console.log(JSON.stringify(cost, null, 2));
      return;
    }

    console.log(chalk.bold('\n  成本估算\n'));
    console.log(`  总成本：${chalk.bold(`$${cost.totalCost.toFixed(4)}`)}`);
    console.log(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    console.log(chalk.bold('\n  按模型：'));
    for (const [model, modelCost] of Object.entries(cost.costByModel)) {
      console.log(`  ${model}: $${modelCost.toFixed(4)}`);
    }

    console.log(chalk.bold('\n  按层级：'));
    console.log(`  高端模型：$${cost.costByTier.premium.toFixed(4)}`);
    console.log(`  标准模型：$${cost.costByTier.standard.toFixed(4)}`);
    console.log(`  经济模型：$${cost.costByTier.economy.toFixed(4)}`);
    console.log('');

    storage.close();
  } catch (err) {
    spinner.fail(`失败: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runHistory(options) {
  const spinner = ora('加载趋势...').start();
  try {
    const { storage } = await createEngine();
    const days = parseInt(options.days, 10);
    const history = storage.getPerformanceHistory(days);

    spinner.succeed('加载完成');

    if (options.json) {
      console.log(JSON.stringify(history, null, 2));
      return;
    }

    if (history.length === 0) {
      console.log(chalk.gray('\n  暂无历史数据。请先运行 `aidog perf analyze`。\n'));
      return;
    }

    console.log(chalk.bold('\n  性能评分趋势\n'));
    const rows = history.map(h => [
      new Date(h.createdAt).toLocaleString('zh-CN'),
      h.score ? `${h.score.score}/100` : '-',
      h.score?.grade || '-',
      h.score?.label || '-',
    ]);
    console.log(createTable(['时间', '评分', '等级', '标签'], rows));

    storage.close();
  } catch (err) {
    spinner.fail(`失败: ${err.message}`);
    process.exitCode = 1;
  }
}

function printPerformanceScore(score) {
  if (!score) {
    console.log(chalk.gray('\n  暂无性能数据\n'));
    return;
  }

  const gradeColor = score.score >= 90 ? chalk.green
    : score.score >= 75 ? chalk.blue
    : score.score >= 60 ? chalk.yellow
    : score.score >= 40 ? chalk.hex('#FF8C00')
    : chalk.red;

  console.log('');
  console.log(`  性能评分：${gradeColor.bold(`${score.score} / 100`)}（${gradeColor(score.grade)} - ${score.label}）`);
  console.log(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (score.breakdown) {
    const dims = [
      { name: '缓存效率', value: score.breakdown.cacheEfficiency, max: 25 },
      { name: 'Token 效率', value: score.breakdown.tokenEfficiency, max: 25 },
      { name: '工具效率', value: score.breakdown.toolEfficiency, max: 20 },
      { name: '会话卫生', value: score.breakdown.sessionHygiene, max: 15 },
      { name: '成本效率', value: score.breakdown.costEfficiency, max: 15 },
    ];
    for (const d of dims) {
      const bar = formatProgressBar(d.value, d.max, 12);
      console.log(`  ${d.name.padEnd(8)} ${bar}  ${String(d.value).padStart(2)}/${d.max}`);
    }
  }

  console.log(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');
}

function printMetricsSummary(metrics) {
  if (!metrics) return;

  console.log(chalk.bold('  概览指标\n'));
  console.log(`  总事件数：${formatNumber(metrics.totalEvents)}`);
  console.log(`  总会话数：${formatNumber(metrics.totalSessions)}`);
  console.log(`  总 Token：${formatTokens(metrics.totalTokens)}`);
  console.log(`  缓存命中率：${(metrics.cacheEfficiency * 100).toFixed(1)}%`);
  if (metrics.avgLatency != null) {
    console.log(`  平均响应延迟：${metrics.avgLatency.toFixed(1)}s`);
  }
  console.log(`  工具调用总数：${formatNumber(metrics.totalToolCalls)}`);
  console.log(`  工具成功率：${(metrics.toolSuccessRate * 100).toFixed(1)}%`);
  if (metrics.cost) {
    console.log(`  估算成本：$${metrics.cost.totalCost.toFixed(4)}`);
  }
  console.log('');
}
