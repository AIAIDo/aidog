import chalk from 'chalk';
import ora from 'ora';
import { SQLiteStorage } from '../../storage/index.js';
import {
  formatNumber,
  formatTokens,
  formatCost,
  formatHealthScore,
  createTable,
} from '../formatters/index.js';
import { PluginRegistry } from '../../plugins/registry.js';
import { createRuleEngine } from '../../rules/index.js';

/**
 * Register the `aidog stats` command.
 * @param {import('commander').Command} program
 */
export function registerStatsCommand(program) {
  program
    .command('stats')
    .description('查看 Token 使用统计')
    .option('--days <n>', '统计天数', '7')
    .option('--agent <name>', '指定 Agent')
    .option('--view <type>', '视图类型 (daily|monthly|session)', 'daily')
    .option('--project <name>', '按项目筛选')
    .action(async (options) => {
      try {
        await runStats(options);
      } catch (err) {
        console.error(chalk.red(`\nStats failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runStats(options) {
  const storage = new SQLiteStorage();
  const days = parseInt(options.days, 10) || 7;
  const agent = options.agent;

  const spinner = ora('Loading statistics...').start();

  try {
    // Get health score via rule engine
    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;
    const events = storage.queryByDateRange(start, now, agent);

    let healthScore = null;
    if (events.length > 0) {
      const engine = createRuleEngine();
      const analysis = await engine.analyze(events);
      healthScore = analysis.healthScore;
    }

    spinner.stop();

    // Display health score
    if (healthScore) {
      console.log(formatHealthScore(healthScore));
    }

    // Summary line
    const totalInput = events.reduce((s, e) => s + (e.inputTokens || 0), 0);
    const totalOutput = events.reduce((s, e) => s + (e.outputTokens || 0), 0);
    const totalTokens = totalInput + totalOutput;
    const totalCacheRead = events.reduce((s, e) => s + (e.cacheRead || 0), 0);
    const sessions = new Set(events.map(e => e.sessionId)).size;

    console.log(chalk.bold(`  总消耗：${formatTokens(totalTokens)}  |  估算费用：${formatCost(totalInput, totalOutput)}  |  Sessions：${formatNumber(sessions)}`));
    console.log('');

    if (options.view === 'monthly') {
      await showMonthlySummary(storage);
    } else if (options.view === 'session') {
      showSessionSummary(events, options.project);
    } else {
      showDailySummary(storage, days, agent);
    }

    // Show top projects
    showTopProjects(events);

    // Show model distribution
    showModelDistribution(events);

    console.log('');
  } finally {
    storage.close();
  }
}

function showDailySummary(storage, days, agent) {
  const daily = storage.getDailySummary(days, agent);

  if (daily.length === 0) {
    console.log(chalk.gray('  No data for this period.\n'));
    return;
  }

  const headers = ['Date', 'Input', 'Output', 'Cache Read', 'Events', 'Sessions'];
  const rows = daily.map(d => [
    d.date,
    formatTokens(d.totalInput),
    formatTokens(d.totalOutput),
    formatTokens(d.totalCacheRead),
    formatNumber(d.eventCount),
    formatNumber(d.sessionCount),
  ]);

  console.log(chalk.bold('  📊 Daily Breakdown\n'));
  console.log(createTable(headers, rows));
}

async function showMonthlySummary(storage) {
  const monthly = storage.getMonthlySummary(6);

  if (monthly.length === 0) {
    console.log(chalk.gray('  No monthly data available.\n'));
    return;
  }

  const headers = ['Month', 'Input', 'Output', 'Cache Read', 'Events', 'Sessions'];
  const rows = monthly.map(m => [
    m.month,
    formatTokens(m.totalInput),
    formatTokens(m.totalOutput),
    formatTokens(m.totalCacheRead),
    formatNumber(m.eventCount),
    formatNumber(m.sessionCount),
  ]);

  console.log(chalk.bold('  📊 Monthly Breakdown\n'));
  console.log(createTable(headers, rows));
}

function showSessionSummary(events, projectFilter) {
  const sessions = {};
  for (const e of events) {
    if (projectFilter && e.projectName !== projectFilter && e.projectPath !== projectFilter) {
      continue;
    }
    if (!sessions[e.sessionId]) {
      sessions[e.sessionId] = {
        sessionId: e.sessionId,
        agent: e.agent,
        project: e.projectName || e.projectPath || '-',
        totalInput: 0,
        totalOutput: 0,
        eventCount: 0,
        firstEvent: e.timestamp,
        lastEvent: e.timestamp,
      };
    }
    const s = sessions[e.sessionId];
    s.totalInput += e.inputTokens || 0;
    s.totalOutput += e.outputTokens || 0;
    s.eventCount++;
    s.firstEvent = Math.min(s.firstEvent, e.timestamp);
    s.lastEvent = Math.max(s.lastEvent, e.timestamp);
  }

  const sessionList = Object.values(sessions)
    .sort((a, b) => b.lastEvent - a.lastEvent)
    .slice(0, 20);

  if (sessionList.length === 0) {
    console.log(chalk.gray('  No session data available.\n'));
    return;
  }

  const headers = ['Session', 'Agent', 'Project', 'Input', 'Output', 'Events'];
  const rows = sessionList.map(s => [
    s.sessionId.slice(0, 8) + '...',
    s.agent || '-',
    (s.project || '-').slice(0, 20),
    formatTokens(s.totalInput),
    formatTokens(s.totalOutput),
    String(s.eventCount),
  ]);

  console.log(chalk.bold('  📊 Session Breakdown\n'));
  console.log(createTable(headers, rows));
}

function showTopProjects(events) {
  const projects = {};
  for (const e of events) {
    const name = e.projectName || e.projectPath || 'unknown';
    if (!projects[name]) projects[name] = { name, tokens: 0 };
    projects[name].tokens += (e.inputTokens || 0) + (e.outputTokens || 0);
  }

  const topProjects = Object.values(projects)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  if (topProjects.length > 0) {
    console.log(chalk.bold('\n  📁 Top Projects\n'));
    for (const p of topProjects) {
      console.log(`    ${p.name.padEnd(30)} ${formatTokens(p.tokens)}`);
    }
  }
}

function showModelDistribution(events) {
  const models = {};
  let total = 0;
  for (const e of events) {
    const model = e.model || 'unknown';
    const tokens = (e.inputTokens || 0) + (e.outputTokens || 0);
    models[model] = (models[model] || 0) + tokens;
    total += tokens;
  }

  const sorted = Object.entries(models).sort((a, b) => b[1] - a[1]);

  if (sorted.length > 0 && total > 0) {
    console.log(chalk.bold('\n  🤖 Model Distribution\n'));
    for (const [model, tokens] of sorted) {
      const pct = ((tokens / total) * 100).toFixed(1);
      console.log(`    ${model.padEnd(35)} ${pct}%  (${formatTokens(tokens)})`);
    }
  }
}
