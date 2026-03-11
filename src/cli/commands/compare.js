import chalk from 'chalk';
import ora from 'ora';
import { SQLiteStorage } from '../../storage/index.js';
import { formatTokens, formatNumber, createTable } from '../formatters/index.js';

/**
 * Register the `aidog compare` command.
 * @param {import('commander').Command} program
 */
export function registerCompareCommand(program) {
  program
    .command('compare')
    .description('对比各 Agent 效率')
    .option('--days <n>', '统计天数', '7')
    .action(async (options) => {
      try {
        await runCompare(options);
      } catch (err) {
        console.error(chalk.red(`\nCompare failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runCompare(options) {
  const storage = new SQLiteStorage();
  const days = parseInt(options.days, 10) || 7;

  const spinner = ora('Loading comparison data...').start();

  try {
    const end = Date.now();
    const start = end - days * 24 * 60 * 60 * 1000;
    const events = storage.queryByDateRange(start, end);

    spinner.stop();

    if (events.length === 0) {
      console.log(chalk.yellow('\nNo events found. Run aidog sync first.\n'));
      return;
    }

    // Group by agent
    const agents = {};
    for (const e of events) {
      const agent = e.agent || 'unknown';
      if (!agents[agent]) {
        agents[agent] = {
          name: agent,
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          events: 0,
          sessions: new Set(),
        };
      }
      const a = agents[agent];
      a.inputTokens += e.inputTokens || 0;
      a.outputTokens += e.outputTokens || 0;
      a.cacheRead += e.cacheRead || 0;
      a.cacheWrite += e.cacheWrite || 0;
      a.events++;
      if (e.sessionId) a.sessions.add(e.sessionId);
    }

    const agentList = Object.values(agents).sort((a, b) =>
      (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
    );

    console.log(chalk.bold(`\n  📊 Agent Comparison (last ${days} days)\n`));

    const headers = [
      'Agent',
      'Total Tokens',
      'Input',
      'Output',
      'Cache Read',
      'Sessions',
      'Events',
      'Avg/Session',
    ];

    const rows = agentList.map(a => {
      const totalTokens = a.inputTokens + a.outputTokens;
      const sessionCount = a.sessions.size;
      const avgPerSession = sessionCount > 0
        ? formatTokens(Math.round(totalTokens / sessionCount))
        : '-';

      const cacheRate = (a.inputTokens + a.cacheRead) > 0
        ? ((a.cacheRead / (a.inputTokens + a.cacheRead)) * 100).toFixed(1) + '%'
        : '-';

      return [
        a.name,
        formatTokens(totalTokens),
        formatTokens(a.inputTokens),
        formatTokens(a.outputTokens),
        `${formatTokens(a.cacheRead)} (${cacheRate})`,
        formatNumber(sessionCount),
        formatNumber(a.events),
        avgPerSession,
      ];
    });

    console.log(createTable(headers, rows));

    // Show efficiency comparison
    if (agentList.length > 1) {
      console.log(chalk.bold('\n  📈 Efficiency Metrics\n'));

      for (const a of agentList) {
        const totalTokens = a.inputTokens + a.outputTokens;
        const sessionCount = a.sessions.size;
        const cacheRate = (a.inputTokens + a.cacheRead) > 0
          ? (a.cacheRead / (a.inputTokens + a.cacheRead))
          : 0;
        const ioRatio = a.outputTokens > 0
          ? (a.inputTokens / a.outputTokens).toFixed(1)
          : '-';

        console.log(`    ${chalk.bold(a.name)}`);
        console.log(chalk.gray(`      Cache hit rate: ${(cacheRate * 100).toFixed(1)}%`));
        console.log(chalk.gray(`      I/O ratio: ${ioRatio}`));
        console.log(chalk.gray(`      Avg tokens/session: ${sessionCount > 0 ? formatTokens(Math.round(totalTokens / sessionCount)) : '-'}`));
        console.log('');
      }
    }

    console.log('');
  } finally {
    storage.close();
  }
}
