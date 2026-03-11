import chalk from 'chalk';
import ora from 'ora';
import { homedir } from 'os';
import { join } from 'path';
import fs from 'fs/promises';
import { PluginRegistry } from '../../plugins/registry.js';

/**
 * Register the `aidog plugins` command with subcommands.
 * @param {import('commander').Command} program
 */
export function registerPluginsCommand(program) {
  const plugins = program
    .command('plugins')
    .description('管理插件');

  plugins
    .command('list')
    .description('列出所有插件及状态')
    .action(async () => {
      try {
        await listPlugins();
      } catch (err) {
        console.error(chalk.red(`\nFailed to list plugins: ${err.message}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('enable <name>')
    .description('启用插件')
    .action(async (name) => {
      try {
        await togglePlugin(name, true);
      } catch (err) {
        console.error(chalk.red(`\nFailed to enable plugin: ${err.message}`));
        process.exitCode = 1;
      }
    });

  plugins
    .command('disable <name>')
    .description('禁用插件')
    .action(async (name) => {
      try {
        await togglePlugin(name, false);
      } catch (err) {
        console.error(chalk.red(`\nFailed to disable plugin: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function listPlugins() {
  const registry = new PluginRegistry();
  await registry.loadUserPlugins();

  const allPlugins = registry.getAll();
  const config = await loadConfig();

  console.log(chalk.bold('\n  📦 Plugins\n'));

  for (const plugin of allPlugins) {
    let available = false;
    try {
      available = await plugin.isAvailable();
    } catch {
      // ignore
    }

    const isEnabled = isPluginEnabled(config, plugin.meta.name);
    const statusIcon = available && isEnabled
      ? chalk.green('●')
      : isEnabled
        ? chalk.yellow('○')
        : chalk.red('○');

    const statusText = available && isEnabled
      ? chalk.green('available')
      : isEnabled && !available
        ? chalk.yellow('not found')
        : chalk.red('disabled');

    console.log(`  ${statusIcon} ${plugin.meta.displayName.padEnd(20)} ${chalk.gray(`v${plugin.meta.version}`).padEnd(20)} ${statusText}`);
    if (plugin.meta.homepage) {
      console.log(chalk.gray(`    ${plugin.meta.homepage}`));
    }
  }

  console.log('');
}

async function togglePlugin(name, enable) {
  const registry = new PluginRegistry();
  await registry.loadUserPlugins();

  const plugin = registry.getByName(name);
  if (!plugin) {
    console.error(chalk.red(`Plugin "${name}" not found.`));
    console.log(chalk.gray('Available plugins: ' + registry.getAll().map(p => p.meta.name).join(', ')));
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();

  if (!config.plugins) {
    config.plugins = [];
  }

  const existing = config.plugins.find(p => p.name === name);
  if (existing) {
    existing.enabled = enable;
  } else {
    config.plugins.push({
      name: plugin.meta.name,
      displayName: plugin.meta.displayName,
      enabled: enable,
    });
  }

  await saveConfig(config);

  const action = enable ? chalk.green('enabled') : chalk.red('disabled');
  console.log(`\n  ${plugin.meta.displayName} has been ${action}.\n`);
}

function isPluginEnabled(config, name) {
  if (!config.plugins) return true; // default to enabled
  const entry = config.plugins.find(p => p.name === name);
  return entry ? entry.enabled !== false : true;
}

async function loadConfig() {
  const configPath = join(homedir(), '.aidog', 'config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  const configDir = join(homedir(), '.aidog');
  const configPath = join(configDir, 'config.json');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}
