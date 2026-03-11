import chalk from 'chalk';
import ora from 'ora';
import { PluginRegistry } from '../../plugins/registry.js';
import { SQLiteStorage } from '../../storage/index.js';
import { formatNumber, formatTokens, formatDate } from '../formatters/index.js';

/**
 * Register the `aidog watch` command.
 * @param {import('commander').Command} program
 */
export function registerWatchCommand(program) {
  program
    .command('watch')
    .description('实时监听 Token 消耗')
    .option('--warn-threshold <n>', '超过阈值时警告 (tokens)', '50000')
    .action(async (options) => {
      try {
        await runWatch(options);
      } catch (err) {
        console.error(chalk.red(`\nWatch failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runWatch(options) {
  const warnThreshold = parseInt(options.warnThreshold, 10) || 50000;
  const storage = new SQLiteStorage();
  const registry = new PluginRegistry();
  await registry.loadUserPlugins();

  const plugins = await registry.getAvailable();

  if (plugins.length === 0) {
    console.log(chalk.yellow('\nNo available agents found. Run aidog setup first.\n'));
    return;
  }

  console.log(chalk.bold('\n👁  Watching token consumption in real-time'));
  console.log(chalk.gray(`   Threshold: ${formatNumber(warnThreshold)} tokens per session`));
  console.log(chalk.gray(`   Agents: ${plugins.map(p => p.meta.displayName).join(', ')}`));
  console.log(chalk.gray('   Press Ctrl+C to stop\n'));

  const spinner = ora({ text: 'Waiting for events...', color: 'cyan' }).start();

  // Track session totals for threshold warnings
  const sessionTotals = {};
  const warnedSessions = new Set();

  const unsubscribers = [];

  for (const plugin of plugins) {
    try {
      const unsubscribe = plugin.watch((events) => {
        const eventList = Array.isArray(events) ? events : [events];

        for (const event of eventList) {
          const totalTokens = (event.inputTokens || event.input_tokens || 0)
            + (event.outputTokens || event.output_tokens || 0);

          const sessionId = event.sessionId || event.session_id || 'unknown';

          // Update session total
          sessionTotals[sessionId] = (sessionTotals[sessionId] || 0) + totalTokens;

          // Update spinner text
          const model = event.model || '';
          const role = event.role || '';
          spinner.text = `${chalk.cyan(plugin.meta.displayName)} | ${role} | ${model} | ${formatTokens(totalTokens)} | Session total: ${formatTokens(sessionTotals[sessionId])}`;

          // Ingest to storage
          try {
            storage.ingestEvents([event]);
          } catch {
            // Silently continue on storage errors
          }

          // Check threshold
          if (sessionTotals[sessionId] >= warnThreshold && !warnedSessions.has(sessionId)) {
            warnedSessions.add(sessionId);
            spinner.warn(
              chalk.yellow(`⚠️  Session ${sessionId.slice(0, 12)}... exceeded ${formatNumber(warnThreshold)} tokens (${formatTokens(sessionTotals[sessionId])})`)
            );
            spinner.start('Watching...');
          }
        }
      });

      unsubscribers.push(unsubscribe);
    } catch (err) {
      console.error(chalk.red(`  Failed to watch ${plugin.meta.displayName}: ${err.message}`));
    }
  }

  // Handle graceful shutdown
  const cleanup = () => {
    spinner.stop();
    console.log(chalk.gray('\n\nStopping watchers...'));

    for (const unsub of unsubscribers) {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        // Ignore cleanup errors
      }
    }

    // Print session summary
    const sessionEntries = Object.entries(sessionTotals);
    if (sessionEntries.length > 0) {
      console.log(chalk.bold('\n  Session Summary:\n'));
      for (const [sid, total] of sessionEntries.sort((a, b) => b[1] - a[1])) {
        const warning = total >= warnThreshold ? chalk.red(' ⚠') : '';
        console.log(`    ${sid.slice(0, 12)}...  ${formatTokens(total)}${warning}`);
      }
    }

    console.log('');
    storage.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
