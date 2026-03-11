import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import fs from 'fs/promises';

/**
 * Register the `aidog config` command with subcommands.
 * @param {import('commander').Command} program
 */
export function registerConfigCommand(program) {
  const config = program
    .command('config')
    .description('管理 aidog 配置');

  config
    .command('show')
    .description('显示当前配置')
    .action(async () => {
      try {
        await showConfig();
      } catch (err) {
        console.error(chalk.red(`\nFailed to show config: ${err.message}`));
        process.exitCode = 1;
      }
    });

  config
    .command('set')
    .description('设置配置项')
    .option('--provider <name>', 'AI 模型提供商 (claude|openai|gemini|kimi|glm|minmax|qoder|ollama|compatible)')
    .option('--model <name>', 'AI 模型名称')
    .option('--warn-threshold <n>', '告警阈值 (tokens)')
    .option('--base-url <url>', 'OpenAI Compatible API base URL')
    .option('--analyze-interval <minutes>', '自动分析间隔（分钟）')
    .action(async (options) => {
      try {
        await setConfig(options);
      } catch (err) {
        console.error(chalk.red(`\nFailed to set config: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function showConfig() {
  const configPath = join(homedir(), '.aidog', 'config.json');

  let config;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    console.log(chalk.yellow('\nNo configuration found. Run aidog setup to initialize.\n'));
    return;
  }

  console.log(chalk.bold('\n  ⚙️  aidog Configuration\n'));
  console.log(chalk.gray(`  Config file: ${configPath}\n`));

  const displayKeys = [
    { key: 'provider', label: 'AI Provider' },
    { key: 'model', label: 'AI Model' },
    { key: 'warnThreshold', label: 'Warn Threshold' },
    { key: 'baseUrl', label: 'API Base URL' },
    { key: 'analyzeInterval', label: 'Analyze Interval' },
    { key: 'version', label: 'Version' },
    { key: 'setupAt', label: 'Setup Date' },
  ];

  for (const { key, label } of displayKeys) {
    const value = config[key];
    if (value !== undefined) {
      console.log(`  ${chalk.cyan(label.padEnd(20))} ${value}`);
    }
  }

  // Show plugins
  if (config.plugins && config.plugins.length > 0) {
    console.log(chalk.bold('\n  Plugins:\n'));
    for (const p of config.plugins) {
      const status = p.enabled !== false ? chalk.green('enabled') : chalk.red('disabled');
      console.log(`    ${(p.displayName || p.name).padEnd(20)} ${status}`);
    }
  }

  console.log('');
}

async function setConfig(options) {
  const configDir = join(homedir(), '.aidog');
  const configPath = join(configDir, 'config.json');

  let config = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // Start fresh
  }

  let changed = false;

  if (options.provider) {
    const validProviders = ['claude', 'openai', 'gemini', 'kimi', 'glm', 'minmax', 'qoder', 'ollama', 'compatible'];
    if (!validProviders.includes(options.provider)) {
      console.error(chalk.red(`Invalid provider: ${options.provider}`));
      console.log(chalk.gray(`Valid providers: ${validProviders.join(', ')}`));
      process.exitCode = 1;
      return;
    }
    config.provider = options.provider;
    changed = true;
  }

  if (options.model) {
    config.model = options.model;
    changed = true;
  }

  if (options.warnThreshold) {
    const threshold = parseInt(options.warnThreshold, 10);
    if (isNaN(threshold) || threshold <= 0) {
      console.error(chalk.red('Warn threshold must be a positive number.'));
      process.exitCode = 1;
      return;
    }
    config.warnThreshold = threshold;
    changed = true;
  }

  if (options.baseUrl) {
    config.baseUrl = options.baseUrl;
    changed = true;
  }

  if (options.analyzeInterval) {
    const interval = parseInt(options.analyzeInterval, 10);
    if (isNaN(interval) || interval < 0) {
      console.error(chalk.red('Analyze interval must be a non-negative number.'));
      process.exitCode = 1;
      return;
    }
    config.analyzeInterval = interval;
    changed = true;
  }

  if (!changed) {
    console.log(chalk.yellow('\nNo configuration changes specified.'));
    console.log(chalk.gray('Available options: --provider, --model, --warn-threshold, --base-url, --analyze-interval\n'));
    return;
  }

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green('\n  ✅ Configuration updated\n'));

  // Show what changed
  if (options.provider) console.log(chalk.gray(`  provider: ${options.provider}`));
  if (options.model) console.log(chalk.gray(`  model: ${options.model}`));
  if (options.warnThreshold) console.log(chalk.gray(`  warnThreshold: ${options.warnThreshold}`));
  if (options.baseUrl) console.log(chalk.gray(`  baseUrl: ${options.baseUrl}`));
  if (options.analyzeInterval) console.log(chalk.gray(`  analyzeInterval: ${options.analyzeInterval}`));
  console.log('');
}
