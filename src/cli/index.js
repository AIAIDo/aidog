import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerWatchCommand } from './commands/watch.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerServeCommand } from './commands/serve.js';
import { registerPluginsCommand } from './commands/plugins.js';
import { registerCompareCommand } from './commands/compare.js';
import { registerConfigCommand } from './commands/config.js';
import { registerSecurityCommand } from './commands/security.js';
import { registerPerformanceCommand } from './commands/performance.js';

/**
 * Create and configure the aidog CLI program.
 * @returns {import('commander').Command}
 */
export function createCLI() {
  const program = new Command();

  program
    .name('aidog')
    .description('ChatOps Toolkit — 面向所有聊天代理的成本、性能、安全、治理一体化守护平台')
    .version('1.0.0');

  // Register all subcommands
  registerSetupCommand(program);
  registerSyncCommand(program);
  registerStatsCommand(program);
  registerAnalyzeCommand(program);
  registerWatchCommand(program);
  registerApplyCommand(program);
  registerServeCommand(program);
  registerPluginsCommand(program);
  registerCompareCommand(program);
  registerConfigCommand(program);
  registerSecurityCommand(program);
  registerPerformanceCommand(program);

  return program;
}
