import chalk from 'chalk';
import ora from 'ora';
import { SQLiteStorage } from '../../storage/index.js';
import { createRuleEngine } from '../../rules/index.js';
import { PromptBuilder } from '../../ai/prompt-builder.js';
import {
  formatNumber,
  formatTokens,
  formatCost,
  formatSeverity,
  formatHealthScore,
  createTable,
  formatDate,
} from '../formatters/index.js';

/**
 * Register the `aidog analyze` command.
 * @param {import('commander').Command} program
 */
export function registerAnalyzeCommand(program) {
  program
    .command('analyze')
    .description('运行规则引擎分析 Token 使用模式')
    .option('--session <id>', '分析指定 session')
    .option('--rule <id>', '只运行指定规则 (e.g., R1, R5)')
    .option('--since <date>', '指定起始日期 (YYYY-MM-DD)')
    .option('--days <n>', '分析天数', '7')
    .option('--detail', '展示规则命中的具体 session 和消息证据')
    .option('--ai', '启用 AI 分析并生成优化建议')
    .option('--stream', 'AI 分析流式输出')
    .option('--dry-run', '预览将发送给 AI 的数据（不实际调用）')
    .option('--local-only', '强制使用本地模型 (Ollama)')
    .option('--provider <name>', 'AI 模型提供商 (claude|openai|gemini|kimi|glm|minmax|qoder|ollama|compatible)')
    .option('--model <name>', '指定 AI 模型')
    .action(async (options) => {
      try {
        await runAnalyze(options);
      } catch (err) {
        console.error(chalk.red(`\nAnalysis failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}

async function runAnalyze(options) {
  const storage = new SQLiteStorage();

  try {
    // Determine time range
    let events;

    if (options.session) {
      events = storage.queryBySession(options.session);
      if (events.length === 0) {
        console.log(chalk.yellow(`\nNo events found for session: ${options.session}\n`));
        return;
      }
    } else {
      const days = parseInt(options.days, 10) || 7;
      const end = Date.now();
      let start;

      if (options.since) {
        start = new Date(options.since).getTime();
        if (isNaN(start)) {
          console.error(chalk.red(`Invalid date: ${options.since}`));
          process.exitCode = 1;
          return;
        }
      } else {
        start = end - days * 24 * 60 * 60 * 1000;
      }

      events = storage.queryByDateRange(start, end);
    }

    if (events.length === 0) {
      console.log(chalk.yellow('\nNo events found for the specified period. Run aidog sync first.\n'));
      return;
    }

    // Run rule engine
    const spinner = ora('Running rule engine analysis...').start();
    const engine = createRuleEngine();
    const analysis = await engine.analyze(events);
    spinner.succeed('Analysis complete');

    // Display results
    displayAnalysisResults(analysis, options);

    // Save analysis batch
    storage.saveAnalysisBatch(analysis);

    // AI analysis
    if (options.ai || options.dryRun) {
      await runAIAnalysis(analysis, events, options);
    }
  } finally {
    storage.close();
  }
}

function displayAnalysisResults(analysis, options) {
  const { totalTokens, totalWastedTokens, byRule, bySeverity, healthScore, summary } = analysis;

  // Health score
  if (healthScore) {
    console.log(formatHealthScore(healthScore));
  }

  // Summary line
  const wastePercent = totalTokens > 0 ? ((totalWastedTokens / totalTokens) * 100).toFixed(1) : '0.0';
  console.log(chalk.bold(`  总消耗：${formatTokens(totalTokens)}  |  估算浪费：${formatTokens(totalWastedTokens)}（${wastePercent}%）`));
  console.log('');

  // Rules by severity
  if (!summary || summary.length === 0) {
    console.log(chalk.green('  No issues detected. Your token usage looks healthy!\n'));
    return;
  }

  // Filter by rule if specified
  let displaySummary = summary;
  if (options.rule) {
    const ruleId = options.rule.toUpperCase();
    displaySummary = summary.filter(s =>
      s.rule && s.rule.toUpperCase().startsWith(ruleId)
    );
    if (displaySummary.length === 0) {
      console.log(chalk.gray(`  No issues found for rule: ${options.rule}\n`));
      return;
    }
  }

  // Sort by severity: high > medium > low
  const severityOrder = { high: 0, medium: 1, low: 2 };
  displaySummary.sort((a, b) =>
    (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
  );

  console.log(chalk.bold('  📋 Detected Issues\n'));

  for (const item of displaySummary) {
    const sev = formatSeverity(item.severity);
    const waste = item.estimatedWastedTokens
      ? chalk.dim(` (~${formatTokens(item.estimatedWastedTokens)} wasted)`)
      : '';
    const occurrences = item.occurrences ? chalk.dim(` × ${item.occurrences} occurrences`) : '';

    console.log(`  ${sev}  ${chalk.bold(item.rule)}${occurrences}${waste}`);

    // Show detail summary
    if (item.detail && typeof item.detail === 'object') {
      const detailStr = Object.entries(item.detail)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}: ${typeof v === 'number' ? formatNumber(v) : v}`)
        .join(', ');
      if (detailStr) {
        console.log(chalk.gray(`     ${detailStr}`));
      }
    }

    console.log('');
  }

  // Show evidence detail if --detail flag is set
  if (options.detail && byRule) {
    showDetailedEvidence(byRule);
  }
}

function showDetailedEvidence(byRule) {
  console.log(chalk.bold('\n  📖 Detailed Evidence\n'));

  for (const [ruleId, results] of Object.entries(byRule)) {
    const items = Array.isArray(results) ? results : [results];

    console.log(chalk.bold.underline(`  ${ruleId}`));
    console.log('');

    for (const result of items) {
      if (!result.evidence || result.evidence.length === 0) continue;

      const sessionLabel = result.sessionId
        ? `Session: ${result.sessionId.slice(0, 12)}...`
        : 'Unknown session';

      console.log(chalk.cyan(`    ${sessionLabel}`));

      const headers = ['Turn', 'Input', 'Output', 'Wasted', 'Reason'];
      const rows = result.evidence.slice(0, 10).map(ev => [
        String(ev.turnIndex || '-'),
        formatTokens(ev.inputTokens || 0),
        formatTokens(ev.outputTokens || 0),
        formatTokens(ev.wastedTokens || 0),
        (ev.reason || '-').slice(0, 50),
      ]);

      console.log(createTable(headers, rows));

      if (result.evidence.length > 10) {
        console.log(chalk.gray(`    ... and ${result.evidence.length - 10} more evidence items\n`));
      }

      console.log('');
    }
  }
}

async function runAIAnalysis(analysis, events, options) {
  const promptBuilder = new PromptBuilder();

  // Build sanitized analysis data for AI
  const analysisData = {
    period: `${new Date(analysis.periodStart).toISOString().slice(0, 10)} ~ ${new Date(analysis.periodEnd).toISOString().slice(0, 10)}`,
    totalTokens: analysis.totalTokens,
    estimatedWastedTokens: analysis.totalWastedTokens,
    sessions: new Set(events.map(e => e.sessionId)).size,
    healthScore: analysis.healthScore,
    detectedPatterns: analysis.summary || [],
    modelDistribution: getModelDistribution(events),
  };

  const provider = options.localOnly ? 'ollama' : (options.provider || 'claude');
  const { systemPrompt, userPrompt } = promptBuilder.build(provider, analysisData);

  if (options.dryRun) {
    console.log(chalk.bold('\n  🔍 Dry Run — Data that would be sent to AI:\n'));
    console.log(chalk.gray('  System Prompt:'));
    console.log(chalk.dim(`  ${systemPrompt.slice(0, 200)}...`));
    console.log('');
    console.log(chalk.gray('  User Prompt (analysis data):'));
    console.log(chalk.dim(JSON.stringify(analysisData, null, 2)));
    console.log(chalk.gray('\n  No AI call was made.\n'));
    return;
  }

  // Attempt to load and use AIManager
  const spinner = ora(`Running AI analysis via ${provider || 'auto-detect'}...`).start();

  try {
    let aiManager;
    try {
      const aiModule = await import('../../ai/index.js');
      aiManager = new aiModule.AIManager();
    } catch (err) {
      spinner.warn(`Failed to load AI module: ${err.message}`);
      console.log(chalk.gray('\n  To enable AI analysis, configure a provider with: aidog config set --provider <name>\n'));
      return;
    }

    let adapter;
    try {
      adapter = await aiManager.selectAdapter(provider || undefined);
    } catch (err) {
      spinner.warn(`AI adapter not available: ${err.message}`);
      console.log(chalk.gray('\n  To enable AI analysis, configure a provider with: aidog config set --provider <name>\n'));
      return;
    }

    const aiOptions = {
      stream: options.stream,
      onChunk: options.stream
        ? (text) => process.stdout.write(text)
        : undefined,
    };

    const report = await aiManager.analyze(analysisData, {
      provider: provider || undefined,
      model: options.model,
      stream: aiOptions.stream,
      onChunk: aiOptions.onChunk,
    });
    spinner.succeed('AI analysis complete');

    if (options.stream) {
      console.log(''); // newline after streaming
    }

    displayAIReport(report);
  } catch (err) {
    spinner.fail(`AI analysis failed: ${err.message}`);
  }
}

function displayAIReport(report) {
  if (!report) return;

  console.log(chalk.bold('\n  🤖 AI Optimization Report\n'));

  if (report.summary) {
    console.log(chalk.white(`  ${report.summary}`));
    console.log('');
  }

  if (report.estimatedSavingsPercent) {
    console.log(chalk.green(`  Estimated savings: ${report.estimatedSavingsPercent}%\n`));
  }

  if (report.recommendations && Array.isArray(report.recommendations)) {
    for (const rec of report.recommendations) {
      const severity = rec.ruleId && rec.ruleId.startsWith('R') ? 'high' : 'medium';
      console.log(`  ${formatSeverity(severity)}  优先级 ${rec.priority}: ${chalk.bold(rec.title)}`);
      console.log(chalk.gray(`     ${rec.explanation}`));

      if (rec.impactTokens) {
        console.log(chalk.dim(`     预计节省: ${formatTokens(rec.impactTokens)}`));
      }

      if (rec.actions && rec.actions.length > 0) {
        for (const action of rec.actions) {
          console.log(chalk.cyan(`     → [${action.type}] ${action.description}`));
          if (action.code) {
            console.log(chalk.dim(`       ${action.code}`));
          }
        }
      }
      console.log('');
    }
  }
}

function getModelDistribution(events) {
  const models = {};
  let total = 0;
  for (const e of events) {
    const model = e.model || 'unknown';
    const tokens = (e.inputTokens || 0) + (e.outputTokens || 0);
    models[model] = (models[model] || 0) + tokens;
    total += tokens;
  }

  const result = {};
  for (const [model, tokens] of Object.entries(models)) {
    result[model] = total > 0 ? `${((tokens / total) * 100).toFixed(0)}%` : '0%';
  }
  return result;
}
