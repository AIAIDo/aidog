import chalk from 'chalk';
import ora from 'ora';
import { homedir } from 'os';
import { join } from 'path';
import fs from 'fs/promises';
import { PluginRegistry } from '../../plugins/registry.js';

/**
 * Register the `aidog setup` command.
 * @param {import('commander').Command} program
 */
export function registerSetupCommand(program) {
  program
    .command('setup')
    .description('自动检测配置，引导首次设置')
    .action(async () => {
      try {
        await runSetup();
      } catch (err) {
        console.error(chalk.red(`\nSetup failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runSetup() {
  console.log(chalk.bold('\n🔍 自动检测已有配置...\n'));

  const spinner = ora('检测 Agent 插件...').start();

  // Detect available plugins
  const registry = new PluginRegistry();
  await registry.loadUserPlugins();
  const allPlugins = registry.getAll();

  spinner.succeed('Agent 插件检测完成');
  console.log('');

  for (const plugin of allPlugins) {
    try {
      const available = await plugin.isAvailable();
      if (available) {
        console.log(chalk.green(`  ✅ ${plugin.meta.displayName}`));
      } else {
        console.log(chalk.gray(`  ❌ ${plugin.meta.displayName}  未检测到`));
      }
    } catch {
      console.log(chalk.gray(`  ❌ ${plugin.meta.displayName}  检测失败`));
    }
  }

  console.log('');

  // Detect AI model availability
  const aiSources = await detectAISources();

  console.log(chalk.bold('📋 AI 配置检测：\n'));

  for (const source of aiSources) {
    if (source.available) {
      console.log(chalk.green(`  ✅ ${source.name.padEnd(20)} 来自 ${source.source}`));
    } else {
      console.log(chalk.gray(`  ❌ ${source.name.padEnd(20)} ${source.reason || '未检测到'}`));
    }
  }

  // List available models
  const availableModels = aiSources.filter(s => s.available);
  if (availableModels.length > 0) {
    console.log(chalk.bold('\n📋 可用的 AI 分析模型：\n'));
    availableModels.forEach((m, i) => {
      const rec = i === 0 ? chalk.cyan(' ← 推荐') : '';
      console.log(`   ${i + 1}. ${m.model}${rec}`);
    });
  }

  // Save config
  const configDir = join(homedir(), '.aidog');
  const configPath = join(configDir, 'config.json');

  let existingConfig = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    existingConfig = JSON.parse(raw);
  } catch {
    // No existing config
  }

  const config = {
    ...existingConfig,
    version: '1.0.0',
    setupAt: new Date().toISOString(),
    plugins: allPlugins.map(p => ({
      name: p.meta.name,
      displayName: p.meta.displayName,
      enabled: true,
    })),
  };

  if (availableModels.length > 0 && !existingConfig.provider) {
    const first = availableModels[0];
    config.provider = first.provider;
    config.model = first.model;
  }

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green(`\n✅ 配置已保存到 ${configPath}`));
  console.log(chalk.gray('\n运行 aidog sync 开始同步数据\n'));
}

/**
 * Detect available AI sources from environment and config files.
 * @returns {Promise<Array<{name: string, available: boolean, source: string, provider: string, model: string, reason?: string}>>}
 */
async function detectAISources() {
  const sources = [];

  // Check Anthropic / Claude
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    sources.push({
      name: 'Claude API Key',
      available: true,
      source: '环境变量 $ANTHROPIC_API_KEY',
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
    });
  } else {
    // Try to read from Claude Code settings
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const raw = await fs.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      if (settings.apiKey || settings.anthropicApiKey) {
        sources.push({
          name: 'Claude API Key',
          available: true,
          source: 'Claude Code（~/.claude/settings.json）',
          provider: 'claude',
          model: settings.model || 'claude-sonnet-4-20250514',
        });
      } else {
        sources.push({ name: 'Claude API Key', available: false, provider: 'claude', model: '', source: '', reason: '未检测到' });
      }
    } catch {
      sources.push({ name: 'Claude API Key', available: false, provider: 'claude', model: '', source: '', reason: '未检测到' });
    }
  }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    sources.push({
      name: 'OpenAI API Key',
      available: true,
      source: '环境变量 $OPENAI_API_KEY',
      provider: 'openai',
      model: 'gpt-4o',
    });
  } else {
    sources.push({ name: 'OpenAI API Key', available: false, provider: 'openai', model: '', source: '', reason: '未检测到' });
  }

  // Check Gemini
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    sources.push({
      name: 'Gemini API Key',
      available: true,
      source: '环境变量',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
    });
  } else {
    sources.push({ name: 'Gemini', available: false, provider: 'gemini', model: '', source: '', reason: '未检测到' });
  }

  // Check Kimi / Moonshot
  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  if (kimiKey) {
    sources.push({
      name: 'Moonshot Kimi',
      available: true,
      source: process.env.KIMI_API_KEY ? '环境变量 $KIMI_API_KEY' : '环境变量 $MOONSHOT_API_KEY',
      provider: 'kimi',
      model: 'moonshot-v1-8k',
    });
  } else {
    sources.push({ name: 'Moonshot Kimi', available: false, provider: 'kimi', model: '', source: '', reason: '未检测到' });
  }

  // Check GLM / Zhipu
  const glmKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY;
  if (glmKey) {
    sources.push({
      name: 'Zhipu GLM',
      available: true,
      source: process.env.GLM_API_KEY ? '环境变量 $GLM_API_KEY' : '环境变量 $ZHIPU_API_KEY',
      provider: 'glm',
      model: 'glm-4-flash',
    });
  } else {
    sources.push({ name: 'Zhipu GLM', available: false, provider: 'glm', model: '', source: '', reason: '未检测到' });
  }

  // Check MiniMax
  const minmaxKey = process.env.MINMAX_API_KEY || process.env.MINIMAX_API_KEY;
  if (minmaxKey) {
    sources.push({
      name: 'MiniMax',
      available: true,
      source: process.env.MINMAX_API_KEY ? '环境变量 $MINMAX_API_KEY' : '环境变量 $MINIMAX_API_KEY',
      provider: 'minmax',
      model: 'MiniMax-Text-01',
    });
  } else {
    sources.push({ name: 'MiniMax', available: false, provider: 'minmax', model: '', source: '', reason: '未检测到' });
  }

  // Check Qwen Qoder / DashScope
  const qoderKey = process.env.QODER_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
  if (qoderKey) {
    sources.push({
      name: 'Qwen Qoder',
      available: true,
      source: process.env.QODER_API_KEY
        ? '环境变量 $QODER_API_KEY'
        : process.env.DASHSCOPE_API_KEY
          ? '环境变量 $DASHSCOPE_API_KEY'
          : '环境变量 $QWEN_API_KEY',
      provider: 'qoder',
      model: 'qwen-plus',
    });
  } else {
    sources.push({ name: 'Qwen Qoder', available: false, provider: 'qoder', model: '', source: '', reason: '未检测到' });
  }

  // Check Ollama
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json();
      const models = data.models || [];
      sources.push({
        name: 'Ollama',
        available: true,
        source: `localhost:11434（${models.length} 个模型）`,
        provider: 'ollama',
        model: models[0]?.name || 'llama3',
      });
    } else {
      sources.push({ name: 'Ollama', available: false, provider: 'ollama', model: '', source: '', reason: '未运行（端口 11434 无响应）' });
    }
  } catch {
    sources.push({ name: 'Ollama', available: false, provider: 'ollama', model: '', source: '', reason: '未运行（端口 11434 无响应）' });
  }

  // Check AWS Bedrock
  try {
    const awsCredPath = join(homedir(), '.aws', 'credentials');
    await fs.access(awsCredPath);
    sources.push({
      name: 'AWS Bedrock',
      available: true,
      source: `~/.aws/credentials（${process.env.AWS_DEFAULT_REGION || 'us-east-1'}）`,
      provider: 'bedrock',
      model: 'claude-haiku（via Bedrock）',
    });
  } catch {
    sources.push({ name: 'AWS Bedrock', available: false, provider: 'bedrock', model: '', source: '', reason: '未检测到' });
  }

  return sources;
}
