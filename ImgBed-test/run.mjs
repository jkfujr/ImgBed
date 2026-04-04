#!/usr/bin/env node
/**
 * ImgBed 测试平台统一入口
 * 支持 frontend / backend / all 三种目标
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clearCache, scanFiles } from './shared/lib/scanner.mjs';
import { Reporter } from './shared/lib/reporter.mjs';
import { RuleRegistry } from './shared/lib/rule-registry.mjs';
import { Fixer } from './shared/lib/fixer.mjs';
import { runAllExternalChecks } from './shared/lib/external-checks.mjs';
import { PATHS, EXTENSIONS, EXCLUDE_DIRS } from './shared/config/paths.mjs';

function parseArgs(argv) {
  const args = {
    help: false,
    format: 'text',
    verify: false,
    color: true,
    exitOnError: false,
    listRules: false,
    fix: false,
    dryRun: false,
    target: 'all',
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--format=')) {
      args.format = arg.slice(9);
    } else if (arg === '--verify') {
      args.verify = true;
    } else if (arg === '--no-color') {
      args.color = false;
    } else if (arg === '--exit-on-error') {
      args.exitOnError = true;
    } else if (arg === '--list-rules') {
      args.listRules = true;
    } else if (arg === '--fix') {
      args.fix = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--target=')) {
      args.target = arg.slice(9);
    } else if (['frontend', 'backend', 'all'].includes(arg)) {
      args.target = arg;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
ImgBed 测试平台
================

用法: node ImgBed-test/run.mjs [--target=frontend|backend|all]

默认行为：顺序执行 frontend 与 backend，并分别输出报告。

可选参数:
  --help, -h              显示帮助信息
  --target=...            指定目标：frontend / backend / all（默认 all）
  --format=json           输出 JSON 格式（默认 text）
  --no-color              禁用彩色输出
  --verify                同时运行结构验证脚本
  --exit-on-error         有 error 级别或外部检查失败时返回非零退出码
  --list-rules            列出可用规则
  --fix                   自动修复（当前仅支持 frontend）
  --dry-run               搭配 --fix 使用，仅预览不写入文件

示例:
  node ImgBed-test/run.mjs --target=frontend
  node ImgBed-test/run.mjs --target=backend --verify
  node ImgBed-test/run.mjs --target=all --exit-on-error
  node ImgBed-test/run.mjs --target=frontend --fix --dry-run
`);
}

function printRuleList(groupedRules) {
  for (const [target, rules] of groupedRules) {
    console.log(`\n${target} 可用规则`);
    console.log('='.repeat(60));
    for (const rule of rules) {
      const fixTag = rule.fixable ? ' [可修复]' : '';
      console.log(`  ${rule.code}  ${rule.severity.padEnd(7)}  ${rule.name}${fixTag}`);
      console.log(`         ${rule.description}`);
    }
    console.log(`共 ${rules.length} 条规则`);
  }
}

function getTargetNames(target) {
  if (target === 'all') return ['frontend', 'backend'];
  if (target === 'frontend' || target === 'backend') return [target];
  throw new Error(`不支持的 target: ${target}`);
}

async function loadFrontendRules() {
  const modules = await Promise.all([
    import('./frontend/rules/bug.mjs'),
    import('./frontend/rules/complexity.mjs'),
    import('./frontend/rules/style.mjs'),
    import('./frontend/rules/architecture.mjs'),
    import('./frontend/rules/performance.mjs'),
    import('./frontend/rules/unused.mjs'),
  ]);
  return modules.flatMap((mod) => mod.default || []);
}

async function loadBackendRules() {
  const modules = await Promise.all([
    import('./backend/rules/architecture.mjs'),
    import('./backend/rules/complexity.mjs'),
    import('./backend/rules/performance.mjs'),
  ]);
  return modules.flatMap((mod) => mod.default || []);
}

async function runFrontendVerify() {
  const { runAllVerifications } = await import('./frontend/verify/refactor-checks.mjs');
  return runAllVerifications();
}

async function runBackendVerify() {
  const { runAllVerifications } = await import('./backend/verify/refactor-checks.mjs');
  return runAllVerifications();
}

async function runBackendUnitTests() {
  const backendTestPath = path.resolve(PATHS.backend.root, 'test', 'unit-test-runner.mjs');
  const { runBackendUnitTests } = await import(pathToFileURL(backendTestPath).href);
  return runBackendUnitTests();
}

async function printBackendUnitTests(result, color) {
  const backendTestPath = path.resolve(PATHS.backend.root, 'test', 'unit-test-runner.mjs');
  const { printUnitTestResults } = await import(pathToFileURL(backendTestPath).href);
  printUnitTestResults(result, color);
}

const TARGET_CONFIGS = {
  frontend: {
    name: 'frontend',
    suiteName: 'ImgBed frontend 代码检测报告',
    footerName: 'ImgBed frontend 代码检测工具',
    projectRoot: PATHS.frontend.root,
    scanRoot: PATHS.frontend.src,
    extensions: EXTENSIONS.frontend,
    exclude: EXCLUDE_DIRS.frontend,
    reportDir: PATHS.test.reportsFrontend,
    supportsFix: true,
    loadRules: loadFrontendRules,
    runVerify: runFrontendVerify,
  },
  backend: {
    name: 'backend',
    suiteName: 'ImgBed backend 代码检测报告',
    footerName: 'ImgBed backend 代码检测工具',
    projectRoot: PATHS.backend.root,
    scanRoot: PATHS.backend.root,
    extensions: EXTENSIONS.backend,
    exclude: EXCLUDE_DIRS.backend,
    reportDir: PATHS.test.reportsBackend,
    supportsFix: false,
    loadRules: loadBackendRules,
    runVerify: runBackendVerify,
    runUnitTests: runBackendUnitTests,
  },
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeTargetReport(reportDir, reporter, totalFiles, ruleList, externalChecks) {
  ensureDir(reportDir);
  const mdContent = reporter.toMarkdown(totalFiles, ruleList, externalChecks);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `report-${timestamp}.md`);
  const latestPath = path.join(reportDir, 'report-latest.md');
  fs.writeFileSync(reportPath, mdContent, 'utf8');
  fs.writeFileSync(latestPath, mdContent, 'utf8');
  return { reportPath, latestPath };
}

function writeCombinedReport(results) {
  const reportDir = PATHS.test.reportsAll;
  ensureDir(reportDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `report-${timestamp}.md`);
  const latestPath = path.join(reportDir, 'report-latest.md');

  const totalIssues = results.reduce((sum, item) => sum + item.reporter.diagnostics.length, 0);
  const hasErrors = results.some((item) => item.reporter.hasErrors());
  const externalFailed = results.some((item) => !item.externalResult.allPassed);
  const verifyFailed = results.some((item) => item.verifyResult && item.verifyResult.failed > 0);
  const unitTestFailed = results.some((item) => item.unitTestResult && !item.unitTestResult.allPassed);

  const lines = [
    '# ImgBed 测试总报告',
    '',
    `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 总览',
    '',
    `- 执行目标数: ${results.length}`,
    `- 总问题数: ${totalIssues}`,
    `- 是否存在规则错误: ${hasErrors ? '是' : '否'}`,
    `- 是否存在外部检查失败: ${externalFailed ? '是' : '否'}`,
    `- 是否存在验证失败: ${verifyFailed ? '是' : '否'}`,
    `- 是否存在单元测试失败: ${unitTestFailed ? '是' : '否'}`,
    '',
    '## 目标摘要',
    '',
    '| 目标 | 扫描文件 | 问题数 | 外部检查 | 结构验证 | 单元测试 | 最新报告 |',
    '|------|----------|--------|----------|----------|----------|----------|',
  ];

  for (const result of results) {
    const verifyLabel = result.verifyResult
      ? `${result.verifyResult.passed} 通过 / ${result.verifyResult.failed} 失败`
      : '未执行';
    const unitTestLabel = result.unitTestResult
      ? `${result.unitTestResult.passed}/${result.unitTestResult.total} (${result.unitTestResult.passRate}%)`
      : '未执行';
    lines.push(`| ${result.target} | ${result.files.length} | ${result.reporter.diagnostics.length} | ${result.externalResult.allPassed ? '通过' : '失败/跳过'} | ${verifyLabel} | ${unitTestLabel} | \`${path.relative(PATHS.testRoot, result.reportPaths.latestPath).replace(/\\/g, '/')}\` |`);
  }

  lines.push('');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  fs.writeFileSync(latestPath, lines.join('\n'), 'utf8');
  return { reportPath, latestPath };
}

async function executeTarget(targetName, args) {
  const config = TARGET_CONFIGS[targetName];
  const rules = await config.loadRules();
  const registry = new RuleRegistry();
  registry.registerAll(rules);

  clearCache();
  const files = scanFiles(config.scanRoot, {
    extensions: config.extensions,
    exclude: config.exclude,
  });

  const reporter = new Reporter({
    color: args.color,
    severity: 'info',
    suiteName: config.suiteName,
    footerName: config.footerName,
  });

  registry.run(files, reporter);
  for (const rule of registry.rules) {
    if (typeof rule.checkAll === 'function') {
      rule.checkAll(files, reporter);
    }
  }

  let currentFiles = files;
  let currentReporter = reporter;

  if (args.format === 'text') {
    reporter.printFullReport(files.length, registry.listRules());
  }

  if (args.fix) {
    if (!config.supportsFix) {
      throw new Error(`${targetName} 当前不支持 --fix`);
    }

    const fixer = new Fixer({
      dryRun: args.dryRun,
      color: args.color,
      reportDir: config.reportDir,
    });
    const fixResult = fixer.run(files, registry.rules, config.scanRoot);

    if (fixResult.fixedFiles > 0 && !args.dryRun) {
      clearCache();
      const rescanned = scanFiles(config.scanRoot, {
        extensions: config.extensions,
        exclude: config.exclude,
      });
      const rescannedReporter = new Reporter({
        color: args.color,
        severity: 'info',
        suiteName: config.suiteName,
        footerName: config.footerName,
      });
      registry.run(rescanned, rescannedReporter);
      for (const rule of registry.rules) {
        if (typeof rule.checkAll === 'function') {
          rule.checkAll(rescanned, rescannedReporter);
        }
      }
      currentFiles = rescanned;
      currentReporter = rescannedReporter;
    }
  }

  const externalResult = runAllExternalChecks({
    target: targetName,
    rootDir: config.projectRoot,
  });

  if (args.format === 'text') {
    console.log('');
    console.log(`${targetName} 外部静态检查`);
    console.log('='.repeat(60));
    for (const check of externalResult.checks) {
      if (check.skipped) {
        console.log(`  ${args.color ? '\x1b[90m⊘\x1b[0m' : '⊘'} ${check.name}: ${args.color ? '\x1b[90m已跳过\x1b[0m' : '已跳过'} (${check.skipReason})`);
      } else if (check.passed) {
        console.log(`  ${args.color ? '\x1b[32m✓\x1b[0m' : '✓'} ${check.name}: ${args.color ? '\x1b[32m通过\x1b[0m' : '通过'}`);
      } else {
        console.log(`  ${args.color ? '\x1b[31m✗\x1b[0m' : '✗'} ${check.name}: ${args.color ? '\x1b[31m失败\x1b[0m' : '失败'} (退出码: ${check.exitCode})`);
        if (check.output) {
          for (const line of check.output.split('\n').slice(0, 10)) {
            console.log(`    ${args.color ? '\x1b[90m' : ''}${line}${args.color ? '\x1b[0m' : ''}`);
          }
        }
      }
    }
    console.log('='.repeat(60));
  }

  const reportPaths = writeTargetReport(
    config.reportDir,
    currentReporter,
    currentFiles.length,
    registry.listRules(),
    externalResult,
  );

  let verifyResult = null;
  if (args.verify) {
    const prevRoot = process.env.IMGBED_SRC_ROOT;
    process.env.IMGBED_SRC_ROOT = config.scanRoot;
    try {
      verifyResult = await config.runVerify();
    } finally {
      if (prevRoot === undefined) {
        delete process.env.IMGBED_SRC_ROOT;
      } else {
        process.env.IMGBED_SRC_ROOT = prevRoot;
      }
    }
  }

  let unitTestResult = null;
  if (config.runUnitTests) {
    unitTestResult = await config.runUnitTests();
    if (args.format === 'text') {
      await printBackendUnitTests(unitTestResult, args.color);
    }
  }

  if (args.format === 'text') {
    console.log(`\n${targetName} 报告已保存: ${path.relative(process.cwd(), reportPaths.reportPath)}`);
    console.log(`${targetName} 最新报告: ${path.relative(process.cwd(), reportPaths.latestPath)}`);
  }

  return {
    target: targetName,
    files: currentFiles,
    reporter: currentReporter,
    externalResult,
    verifyResult,
    unitTestResult,
    reportPaths,
    rules: registry.listRules(),
  };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.dryRun && !args.fix) {
    console.error('--dry-run 必须搭配 --fix 使用');
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    return;
  }

  const targets = getTargetNames(args.target);
  if (args.fix && targets.length !== 1) {
    console.error('--fix 当前只能搭配单个 target 使用');
    process.exit(2);
  }

  if (args.listRules) {
    const groupedRules = [];
    for (const target of targets) {
      groupedRules.push([target, (await TARGET_CONFIGS[target].loadRules()).map((rule) => ({
        code: rule.code,
        severity: rule.severity,
        name: rule.name,
        description: rule.description,
        fixable: !!rule.fixable,
      }))]);
    }
    printRuleList(groupedRules);
    return;
  }

  const results = [];
  for (const target of targets) {
    if (args.format === 'text') {
      console.log('');
      console.log(`# 执行目标: ${target}`);
      console.log('='.repeat(60));
    }
    results.push(await executeTarget(target, args));
  }

  if (args.target === 'all') {
    const combined = writeCombinedReport(results);
    if (args.format === 'text') {
      console.log(`\n总报告已保存: ${path.relative(process.cwd(), combined.reportPath)}`);
      console.log(`总报告最新: ${path.relative(process.cwd(), combined.latestPath)}`);
    }
  }

  if (args.format === 'json') {
    console.log(JSON.stringify(results.map((item) => ({
      target: item.target,
      summary: item.reporter.toJSON(item.files.length).summary,
      externalChecks: item.externalResult,
      verify: item.verifyResult,
      unitTests: item.unitTestResult,
      reports: {
        reportPath: item.reportPaths.reportPath,
        latestPath: item.reportPaths.latestPath,
      },
    })), null, 2));
  }

  const failed = results.some((item) => {
    const verifyFailed = item.verifyResult ? item.verifyResult.failed > 0 : false;
    const unitTestFailed = item.unitTestResult ? !item.unitTestResult.allPassed : false;
    return item.reporter.hasErrors() || !item.externalResult.allPassed || verifyFailed || unitTestFailed;
  });

  if (args.exitOnError && failed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('检测工具执行异常:', err.message);
  process.exit(2);
});
