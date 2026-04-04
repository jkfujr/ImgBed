#!/usr/bin/env node
/**
 * ImgBed-web 代码检测工具 — 一键扫描入口
 * 前端代码质量检测
 *
 * 用法: node test/run.mjs
 *
 * 默认行为：扫描全部文件、运行全部规则、输出完整详细报告
 *
 * 可选参数:
 *   --help, -h              显示帮助信息
 *   --format=json            输出 JSON 格式（默认 text）
 *   --no-color               禁用彩色输出
 *   --verify                 同时运行重构验证检查
 *   --exit-on-error          有 error 级别时返回非零退出码（CI 模式）
 *   --list-rules             列出所有可用规则
 *   --fix                    自动修复可修复的问题
 *   --dry-run                搭配 --fix 使用，仅预览不写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProjectRoot, scanFiles } from './lib/scanner.mjs';
import { Reporter } from './lib/reporter.mjs';
import { RuleRegistry } from './lib/rule-registry.mjs';
import { Fixer } from './lib/fixer.mjs';
import { runAllExternalChecks } from './lib/external-checks.mjs';

// 导入所有规则模块
import bugRules from './rules/bug.mjs';
import complexityRules from './rules/complexity.mjs';
import styleRules from './rules/style.mjs';
import architectureRules from './rules/architecture.mjs';
import performanceRules from './rules/performance.mjs';
import unusedRules from './rules/unused.mjs';

// 解析命令行参数
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
    }
  }

  return args;
}

function printHelp() {
  console.log(`
ImgBed-web 代码检测工具
========================

用法: node test/run.mjs

默认行为：一键扫描全部文件，运行全部规则，输出完整详细报告。

可选参数:
  --help, -h              显示帮助信息
  --format=json            输出 JSON 格式（默认 text）
  --no-color               禁用彩色输出
  --verify                 同时运行重构验证检查
  --exit-on-error          有 error 级别时返回非零退出码（CI 模式）
  --list-rules             列出所有可用规则
  --fix                    自动修复可修复的问题
  --dry-run                搭配 --fix 使用，仅预览修改不写入文件

示例:
  node test/run.mjs                         # 一键全量扫描
  node test/run.mjs --verify                # 同时运行重构验证
  node test/run.mjs --format=json           # JSON 输出
  node test/run.mjs --exit-on-error         # CI 模式
  node test/run.mjs --fix                   # 自动修复
  node test/run.mjs --fix --dry-run         # 预览修复（不写入）
`);
}

function printRuleList(registry) {
  const catLabels = {
    style: 'S 风格',
    bug: 'B 缺陷',
    complexity: 'C 复杂度',
    performance: 'P 性能',
    architecture: 'A 架构',
    unused: 'U 冗余',
  };

  const rules = registry.listRules();
  const grouped = {};
  for (const rule of rules) {
    const cat = rule.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(rule);
  }

  console.log('\n可用规则列表');
  console.log('='.repeat(60));

  for (const [cat, catRules] of Object.entries(grouped)) {
    console.log(`\n${catLabels[cat] || cat}`);
    console.log('-'.repeat(40));
    for (const rule of catRules) {
      const severityTag = rule.severity.padEnd(7);
      const fixTag = rule.fixable ? ' [可修复]' : '';
      console.log(`  ${rule.code}  ${severityTag}  ${rule.name}${fixTag}`);
      console.log(`         ${rule.description}`);
    }
  }

  console.log(`\n共 ${rules.length} 条规则`);
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

  // 注册所有规则
  const registry = new RuleRegistry();
  registry.registerAll(bugRules);
  registry.registerAll(complexityRules);
  registry.registerAll(styleRules);
  registry.registerAll(architectureRules);
  registry.registerAll(performanceRules);
  registry.registerAll(unusedRules);

  if (args.listRules) {
    printRuleList(registry);
    return;
  }

  // 扫描全部文件
  const rootDir = resolveProjectRoot();
  const files = scanFiles(rootDir);

  // 项目根目录（用于外部检查）
  const projectRoot = path.resolve(rootDir, '..');

  // 创建报告器（info 级别全部输出）
  const reporter = new Reporter({
    color: args.color,
    severity: 'info',
  });

  // 执行所有规则
  registry.run(files, reporter);

  // A02 循环依赖需要全局检测
  const a02Rule = registry.rules.find(r => r.code === 'A02');
  if (a02Rule && a02Rule.checkAll) {
    a02Rule.checkAll(files, reporter);
  }

  // 输出完整报告
  const ruleList = registry.listRules();
  let currentFiles = files;
  let currentReporter = reporter;
  if (args.format === 'json') {
    console.log(JSON.stringify(reporter.toJSON(files.length), null, 2));
  } else {
    reporter.printFullReport(files.length, ruleList);
  }

  // --fix 模式：执行自动修复
  if (args.fix) {
    const fixer = new Fixer({
      dryRun: args.dryRun,
      color: args.color,
    });
    const fixResult = fixer.run(files, registry.rules, rootDir);

    if (fixResult.fixedFiles > 0 && !args.dryRun) {
      // 修复后重新扫描，展示剩余问题
      const { scanFiles: reScan, clearCache } = await import('./lib/scanner.mjs');
      clearCache();
      const newFiles = reScan(rootDir);
      const newReporter = new Reporter({ color: args.color, severity: 'info' });
      registry.run(newFiles, newReporter);
      const a02Rule = registry.rules.find(r => r.code === 'A02');
      if (a02Rule && a02Rule.checkAll) a02Rule.checkAll(newFiles, newReporter);

      currentFiles = newFiles;
      currentReporter = newReporter;

      const remaining = newReporter.diagnostics.length;
      const fixed = reporter.diagnostics.length - remaining;
      console.log(args.color
        ? `\x1b[32m  修复后剩余 ${remaining} 个问题（本次修复 ${fixed} 个）\x1b[0m`
        : `  修复后剩余 ${remaining} 个问题（本次修复 ${fixed} 个）`
      );
    }
  }

  // 外部静态检查
  console.log('');
  console.log('外部静态检查');
  console.log('='.repeat(60));
  const externalResult = runAllExternalChecks(projectRoot);
  for (const check of externalResult.checks) {
    if (check.skipped) {
      console.log(`  ${args.color ? '\x1b[90m⊘\x1b[0m' : '⊘'} ${check.name}: ${args.color ? '\x1b[90m已跳过\x1b[0m' : '已跳过'} (${check.skipReason})`);
    } else if (check.passed) {
      console.log(`  ${args.color ? '\x1b[32m✓\x1b[0m' : '✓'} ${check.name}: ${args.color ? '\x1b[32m通过\x1b[0m' : '通过'}`);
    } else {
      console.log(`  ${args.color ? '\x1b[31m✗\x1b[0m' : '✗'} ${check.name}: ${args.color ? '\x1b[31m失败\x1b[0m' : '失败'} (退出码: ${check.exitCode})`);
      if (check.output) {
        const lines = check.output.split('\n').slice(0, 10);
        for (const line of lines) {
          console.log(`    ${args.color ? '\x1b[90m' : ''}${line}${args.color ? '\x1b[0m' : ''}`);
        }
        if (check.output.split('\n').length > 10) {
          console.log(`    ${args.color ? '\x1b[90m...(输出已截断)\x1b[0m' : '...(输出已截断)'}`);
        }
      }
    }
  }
  console.log('='.repeat(60));

  // 生成 Markdown 报告文件
  const mdContent = currentReporter.toMarkdown(currentFiles.length, ruleList, externalResult);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const reportDir = path.join(scriptDir, 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `report-${timestamp}.md`);
  fs.writeFileSync(reportPath, mdContent, 'utf8');

  // 同时维护一个 latest 软链/副本
  const latestPath = path.join(reportDir, 'report-latest.md');
  fs.writeFileSync(latestPath, mdContent, 'utf8');

  console.log(`\n报告已保存: ${path.relative(process.cwd(), reportPath)}`);
  console.log(`最新报告:   ${path.relative(process.cwd(), latestPath)}`);

  // 重构验证
  if (args.verify) {
    const { runAllVerifications } = await import('./verify/refactor-checks.mjs');
    runAllVerifications();
  }

  // CI 退出码
  if (args.exitOnError && (currentReporter.hasErrors() || !externalResult.allPassed)) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('检测工具执行异常:', err.message);
  process.exit(2);
});
