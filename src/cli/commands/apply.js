import chalk from 'chalk';
import ora from 'ora';
import { homedir } from 'os';
import { join } from 'path';
import fs from 'fs/promises';
import { SQLiteStorage } from '../../storage/index.js';

/**
 * Register the `aidog apply` command.
 * @param {import('commander').Command} program
 */
export function registerApplyCommand(program) {
  program
    .command('apply')
    .description('应用优化建议')
    .option('--fix <type>', '要应用的优化 (mcp-cleanup|cache-hint)')
    .option('--list', '列出所有可用的优化项')
    .option('--dry-run', '预览变更，不实际修改')
    .action(async (options) => {
      try {
        await runApply(options);
      } catch (err) {
        console.error(chalk.red(`\nApply failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

const AVAILABLE_FIXES = [
  {
    id: 'mcp-cleanup',
    name: 'MCP Server Cleanup',
    description: '清理未使用的 MCP Server，减少每轮 schema token 开销',
  },
  {
    id: 'cache-hint',
    name: 'Cache Hint Generation',
    description: '生成 CLAUDE.md 模板，提升缓存命中率',
  },
];

async function runApply(options) {
  if (options.list) {
    listFixes();
    return;
  }

  if (!options.fix) {
    console.log(chalk.yellow('\nPlease specify a fix with --fix <type> or use --list to see available fixes.\n'));
    listFixes();
    return;
  }

  switch (options.fix) {
    case 'mcp-cleanup':
      await applyMcpCleanup(options.dryRun);
      break;
    case 'cache-hint':
      await applyCacheHint(options.dryRun);
      break;
    default:
      console.error(chalk.red(`Unknown fix: ${options.fix}`));
      console.log(chalk.gray('Use --list to see available fixes.\n'));
      process.exitCode = 1;
  }
}

function listFixes() {
  console.log(chalk.bold('\n  📋 Available Fixes\n'));
  for (const fix of AVAILABLE_FIXES) {
    console.log(`  ${chalk.cyan(fix.id.padEnd(20))} ${fix.name}`);
    console.log(chalk.gray(`  ${''.padEnd(20)} ${fix.description}`));
    console.log('');
  }
  console.log(chalk.gray('  Usage: aidog apply --fix <id> [--dry-run]\n'));
}

async function applyMcpCleanup(dryRun) {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  let settings;
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch (err) {
    console.error(chalk.red(`\nCannot read Claude settings: ${err.message}`));
    console.log(chalk.gray(`Expected at: ${settingsPath}\n`));
    process.exitCode = 1;
    return;
  }

  const mcpServers = settings.mcpServers || {};
  const serverNames = Object.keys(mcpServers);

  if (serverNames.length === 0) {
    console.log(chalk.green('\nNo MCP servers configured. Nothing to clean up.\n'));
    return;
  }

  console.log(chalk.bold(`\n  🔧 MCP Server Cleanup\n`));
  console.log(chalk.gray(`  Found ${serverNames.length} MCP server(s) in settings:\n`));

  // Check which MCPs are actually used by querying storage
  const storage = new SQLiteStorage();
  const days = 7;
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const events = storage.queryByDateRange(start, end);
  storage.close();

  // Extract tool names from events
  const usedTools = new Set();
  for (const e of events) {
    if (Array.isArray(e.toolCalls)) {
      for (const tc of e.toolCalls) {
        if (tc.name) usedTools.add(tc.name.toLowerCase());
      }
    }
  }

  const unusedServers = [];
  const usedServers = [];

  for (const name of serverNames) {
    // Heuristic: check if any tool name contains the server name
    const isUsed = [...usedTools].some(tool =>
      tool.includes(name.toLowerCase()) || name.toLowerCase().includes(tool)
    );

    if (isUsed) {
      usedServers.push(name);
      console.log(chalk.green(`    ✅ ${name}  — used this week`));
    } else {
      unusedServers.push(name);
      console.log(chalk.yellow(`    ⚠️  ${name}  — not used this week`));
    }
  }

  console.log('');

  if (unusedServers.length === 0) {
    console.log(chalk.green('  All MCP servers are actively used. No cleanup needed.\n'));
    return;
  }

  console.log(chalk.yellow(`  ${unusedServers.length} unused MCP server(s) can be disabled.\n`));

  if (dryRun) {
    console.log(chalk.gray('  [Dry Run] Would disable the following servers:'));
    for (const name of unusedServers) {
      console.log(chalk.gray(`    - ${name}`));
    }
    console.log(chalk.gray('\n  Run without --dry-run to apply changes.\n'));
    return;
  }

  // Disable unused servers by adding "disabled": true
  for (const name of unusedServers) {
    if (typeof mcpServers[name] === 'object') {
      mcpServers[name].disabled = true;
    }
  }

  // Write back
  try {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    console.log(chalk.green(`  ✅ Disabled ${unusedServers.length} unused MCP server(s)`));
    console.log(chalk.gray(`  Settings saved to: ${settingsPath}`));
    console.log(chalk.gray('  To re-enable: aidog plugins enable <name> or edit settings.json\n'));
  } catch (err) {
    console.error(chalk.red(`  Failed to write settings: ${err.message}\n`));
    process.exitCode = 1;
  }
}

async function applyCacheHint(dryRun) {
  console.log(chalk.bold('\n  📝 Cache Hint Generation\n'));

  const cwd = process.cwd();
  const claudeMdPath = join(cwd, 'CLAUDE.md');

  const template = `# Project Context for Claude

## Project Overview
<!-- Describe your project in 2-3 sentences -->

## Tech Stack
<!-- List main technologies, frameworks, and libraries -->

## Project Structure
<!-- Key directories and their purposes -->

## Coding Conventions
<!-- Style guide, naming conventions, patterns used -->

## Important Files
<!-- List files that Claude should be aware of -->

## Common Commands
<!-- Frequently used dev commands -->
- \`npm run dev\` - Start development server
- \`npm test\` - Run tests
- \`npm run build\` - Build for production

## Notes
<!-- Any other context that helps Claude understand the project -->
`;

  if (dryRun) {
    console.log(chalk.gray('  [Dry Run] Would create CLAUDE.md at:'));
    console.log(chalk.gray(`  ${claudeMdPath}\n`));
    console.log(chalk.gray('  Template content:\n'));
    console.log(chalk.dim(template));
    return;
  }

  // Check if CLAUDE.md already exists
  try {
    await fs.access(claudeMdPath);
    console.log(chalk.yellow(`  CLAUDE.md already exists at: ${claudeMdPath}`));
    console.log(chalk.gray('  Skipping to avoid overwriting existing content.\n'));
    return;
  } catch {
    // File does not exist — proceed
  }

  try {
    await fs.writeFile(claudeMdPath, template);
    console.log(chalk.green(`  ✅ Created CLAUDE.md at: ${claudeMdPath}`));
    console.log(chalk.gray('  Edit this file with your project-specific context to improve cache hit rates.'));
    console.log(chalk.gray('  A well-crafted CLAUDE.md can improve cache efficiency by 30-60%.\n'));
  } catch (err) {
    console.error(chalk.red(`  Failed to create CLAUDE.md: ${err.message}\n`));
    process.exitCode = 1;
  }
}
