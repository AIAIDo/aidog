import chalk from 'chalk';
import ora from 'ora';
import { formatSeverity, createTable, formatDate } from '../formatters/index.js';

/**
 * Register the `aidog security` command (alias: sec).
 * @param {import('commander').Command} program
 */
export function registerSecurityCommand(program) {
  const sec = program
    .command('security')
    .alias('sec')
    .description('安全检测 — 暴露检测与敏感信息泄漏扫描');

  // aidog sec scan — full scan
  sec
    .command('scan')
    .description('完整安全扫描（暴露检测 + 泄漏扫描）')
    .option('--since <date>', '仅扫描此日期之后的数据')
    .option('--severity <level>', '仅显示此级别及以上的结果')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      await runScan('full', options);
    });

  // aidog sec exposure
  sec
    .command('exposure')
    .description('暴露检测 — 端口/穿透工具')
    .option('--ports <list>', '指定检测端口（逗号分隔）')
    .option('--timeout <ms>', '端口探测超时（毫秒）', '3000')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      await runScan('exposure', options);
    });

  // aidog sec leakage
  sec
    .command('leakage')
    .description('泄漏扫描 — 敏感信息检测')
    .option('--since <date>', '仅扫描此日期之后的数据')
    .option('--rules <list>', '仅使用指定规则（逗号分隔）')
    .option('--json', '输出 JSON 格式')
    .action(async (options) => {
      await runScan('leakage', options);
    });

  // aidog sec rules
  sec
    .command('rules')
    .description('列出所有安全检测规则')
    .action(async () => {
      await listRules();
    });
}

async function runScan(type, options) {
  const spinner = ora('加载安全模块...').start();

  try {
    const { SecurityEngine } = await import('../../security/index.js');
    const { PluginRegistry } = await import('../../plugins/registry.js');

    const registry = new PluginRegistry();
    await registry.loadUserPlugins();

    const securityEngine = new SecurityEngine({ pluginRegistry: registry });

    spinner.text = '正在扫描...';

    const scanOptions = {};
    if (options.since) scanOptions.since = new Date(options.since);
    if (options.ports) scanOptions.ports = options.ports.split(',').map(Number);
    if (options.rules) scanOptions.ruleIds = options.rules.split(',');

    let result;
    if (type === 'full') {
      result = await securityEngine.scan(scanOptions);
    } else if (type === 'exposure') {
      const exposure = await securityEngine.scanExposure(scanOptions);
      result = { scanId: `sec_cli`, scannedAt: new Date(), exposure, securityScore: securityEngine.calculateSecurityScore(null, exposure) };
    } else {
      const leakage = await securityEngine.scanLeakage(scanOptions);
      result = { scanId: `sec_cli`, scannedAt: new Date(), leakage, securityScore: securityEngine.calculateSecurityScore(leakage, null) };
    }

    spinner.succeed('扫描完成');

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Print security score
    printSecurityScore(result.securityScore);

    // Print leakage findings
    if (result.leakage) {
      printLeakageResults(result.leakage, options.severity);
    }

    // Print exposure findings
    if (result.exposure) {
      printExposureResults(result.exposure);
    }
  } catch (err) {
    spinner.fail(`扫描失败: ${err.message}`);
    process.exitCode = 1;
  }
}

function printSecurityScore(score) {
  if (!score) return;

  const gradeColor = score.score >= 90 ? chalk.green
    : score.score >= 75 ? chalk.blue
    : score.score >= 60 ? chalk.yellow
    : score.score >= 40 ? chalk.hex('#FF8C00')
    : chalk.red;

  console.log('');
  console.log(`  安全健康分：${gradeColor.bold(`${score.score} / 100`)}（${gradeColor(score.grade)} - ${score.label}）`);
  console.log(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  if (score.breakdown) {
    console.log(`  泄漏安全  ${score.breakdown.leakage}/50`);
    console.log(`  暴露安全  ${score.breakdown.exposure}/50`);
  }
  console.log(chalk.gray('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');
}

function printLeakageResults(leakage, severityFilter) {
  console.log(chalk.bold('\n📋 泄漏扫描结果\n'));
  console.log(`  扫描文件：${leakage.filesScanned} 个`);
  console.log(`  扫描行数：${leakage.linesScanned} 行`);
  console.log(`  发现问题：${leakage.totalFindings} 个`);

  let findings = leakage.findings || [];
  if (severityFilter) {
    const levels = ['critical', 'high', 'medium', 'low'];
    const idx = levels.indexOf(severityFilter);
    if (idx >= 0) {
      const allowed = new Set(levels.slice(0, idx + 1));
      findings = findings.filter(f => allowed.has(f.severity));
    }
  }

  if (findings.length === 0) {
    console.log(chalk.green('\n  ✅ 未发现敏感信息泄漏\n'));
    return;
  }

  console.log('');
  const rows = findings.map(f => [
    formatSeverity(f.severity),
    f.ruleId,
    f.ruleName || f.ruleId,
    f.maskedSnippet || '-',
    f.filePath ? f.filePath.split('/').pop() : '-',
  ]);
  console.log(createTable(['级别', '规则', '名称', '脱敏片段', '文件'], rows));
}

function printExposureResults(exposure) {
  console.log(chalk.bold('\n🌐 暴露检测结果\n'));

  if (exposure.publicIp) {
    console.log(`  公网 IP：${exposure.publicIp}`);
  } else {
    console.log(chalk.gray('  公网 IP：无法获取'));
  }

  const portFindings = exposure.portFindings || [];
  const tunnelFindings = exposure.tunnelFindings || [];

  if (portFindings.length === 0 && tunnelFindings.length === 0) {
    console.log(chalk.green('\n  ✅ 未发现公网暴露风险\n'));
    return;
  }

  if (portFindings.length > 0) {
    console.log(chalk.bold('\n  端口可达性：'));
    const rows = portFindings.map(f => [
      formatSeverity(f.severity),
      String(f.port),
      f.service || '-',
      f.reachable ? chalk.red('可达') : chalk.green('不可达'),
    ]);
    console.log(createTable(['级别', '端口', '服务', '状态'], rows));
  }

  if (tunnelFindings.length > 0) {
    console.log(chalk.bold('\n  穿透工具：'));
    const rows = tunnelFindings.map(f => [
      formatSeverity(f.severity || 'high'),
      f.tool,
      String(f.pid || '-'),
      f.command || '-',
    ]);
    console.log(createTable(['级别', '工具', 'PID', '命令'], rows));
  }
}

async function listRules() {
  try {
    const { SecurityEngine } = await import('../../security/index.js');
    const engine = new SecurityEngine();
    const { builtIn, custom } = engine.listRules();

    console.log(chalk.bold('\n📏 安全检测规则\n'));

    if (builtIn.length > 0) {
      console.log(chalk.cyan.bold('  内置规则：'));
      const rows = builtIn.map(r => [
        r.id,
        r.name,
        formatSeverity(r.severity),
        r.description || '-',
      ]);
      console.log(createTable(['ID', '名称', '级别', '说明'], rows));
    }

    if (custom.length > 0) {
      console.log(chalk.cyan.bold('\n  自定义规则：'));
      const rows = custom.map(r => [
        r.id,
        r.name,
        formatSeverity(r.severity),
        r.description || '-',
      ]);
      console.log(createTable(['ID', '名称', '级别', '说明'], rows));
    } else {
      console.log(chalk.gray('\n  暂无自定义规则。可在 ~/.aidog/config.json 的 security.customRules 中配置。'));
    }

    console.log('');
  } catch (err) {
    console.error(chalk.red(`加载规则失败: ${err.message}`));
    process.exitCode = 1;
  }
}
