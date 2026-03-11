import chalk from 'chalk';
import ora from 'ora';
import { PluginRegistry } from '../../plugins/registry.js';
import { SQLiteStorage } from '../../storage/index.js';
import { formatNumber, formatTokens } from '../formatters/index.js';

/**
 * Register the `aidog sync` command.
 * @param {import('commander').Command} program
 */
export function registerSyncCommand(program) {
  program
    .command('sync')
    .description('手动同步最新数据')
    .option('--agent <name>', '指定 Agent（默认：所有可用）')
    .action(async (options) => {
      try {
        await runSync(options);
      } catch (err) {
        console.error(chalk.red(`\nSync failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runSync(options) {
  const storage = new SQLiteStorage();
  const registry = new PluginRegistry();
  await registry.loadUserPlugins();

  let plugins;
  if (options.agent) {
    const plugin = registry.getByName(options.agent);
    if (!plugin) {
      console.error(chalk.red(`Agent "${options.agent}" not found.`));
      console.log(chalk.gray('Available agents: ' + registry.getAll().map(p => p.meta.name).join(', ')));
      process.exitCode = 1;
      return;
    }
    plugins = [plugin];
  } else {
    plugins = await registry.getAvailable();
  }

  if (plugins.length === 0) {
    console.log(chalk.yellow('\nNo available agents found. Run aidog setup first.\n'));
    return;
  }

  console.log(chalk.bold(`\n📥 Syncing data from ${plugins.length} agent(s)...\n`));

  let totalNewEvents = 0;

  for (const plugin of plugins) {
    const spinner = ora(`Syncing ${plugin.meta.displayName}...`).start();

    try {
      // Determine since date from sync metadata
      const lastSyncKey = `last_sync_${plugin.meta.name}`;
      const lastSync = storage.getSyncMeta(lastSyncKey);
      const since = lastSync ? new Date(parseInt(lastSync, 10)) : undefined;

      const events = await plugin.fetchHistory(since);

      if (events.length > 0) {
        storage.ingestEvents(events);
        totalNewEvents += events.length;
        spinner.succeed(`${plugin.meta.displayName}: ${formatNumber(events.length)} events synced`);
      } else {
        spinner.succeed(`${plugin.meta.displayName}: no new events`);
      }

      // Only advance the sync cursor after a successful fetch + ingest cycle.
      storage.setSyncMeta(lastSyncKey, String(Date.now()));
    } catch (err) {
      spinner.fail(`${plugin.meta.displayName}: ${err.message}`);
    }
  }

  console.log('');
  console.log(chalk.bold(`  Total new events: ${formatNumber(totalNewEvents)}`));

  // Show overall stats
  const daily = storage.getDailySummary(1);
  if (daily.length > 0) {
    const today = daily[0];
    const totalTokens = (today.totalInput || 0) + (today.totalOutput || 0);
    console.log(chalk.gray(`  Today's total: ${formatTokens(totalTokens)} across ${formatNumber(today.sessionCount || 0)} sessions`));
  }

  console.log('');
  storage.close();
}
