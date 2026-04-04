import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const frontendRoot = path.join(repoRoot, 'ImgBed-web');
const testRoot = path.join(repoRoot, 'ImgBed-test');
const fixerPath = path.join(testRoot, 'shared', 'lib', 'fixer.mjs');
const runPath = path.join(testRoot, 'run.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testFixerPatchPath() {
  const tempRoot = makeTempDir('imgbed-fixer-path-');
  const previousCwd = process.cwd();
  try {
    const { Fixer } = await import(pathToFileURL(fixerPath).href);
    process.chdir(tempRoot);

    const sourceRoot = path.join(tempRoot, 'src');
    const filePath = path.join(sourceRoot, 'demo.jsx');
    writeFile(filePath, "import React from 'react';\nexport default function Demo() {\n  return <div>ok</div>;\n}\n");

    const files = [{
      filePath,
      relativePath: 'demo.jsx',
      content: fs.readFileSync(filePath, 'utf8'),
      lines: fs.readFileSync(filePath, 'utf8').split('\n'),
    }];

    const fixer = new Fixer({ dryRun: true, color: false });
    const result = fixer.run(files, [{
      code: 'T01',
      fixable: true,
      fix(file) {
        return {
          content: file.content.replace("import React from 'react';\n", ''),
          changes: [{ line: 1, description: '移除测试导入' }],
        };
      },
    }], sourceRoot);

    assert(result.patchPath, 'Fixer 未返回 patch 路径');
    assert(fs.existsSync(result.patchPath), 'Fixer 未生成 patch 文件');
    assert(!result.patchPath.includes('f:\\f:\\'), `Fixer 生成了异常 Windows 路径: ${result.patchPath}`);

    const patchContent = fs.readFileSync(result.patchPath, 'utf8');
    assert(patchContent.includes('--- a/src/demo.jsx'), 'patch 头缺少旧文件路径');
    assert(patchContent.includes('+++ b/src/demo.jsx'), 'patch 头缺少新文件路径');
    assert(fs.readFileSync(filePath, 'utf8').includes("import React from 'react';"), 'dry-run 不应修改源文件');

    return { name: 'Fixer patch 路径与 dry-run', ok: true };
  } finally {
    process.chdir(previousCwd);
    removeDir(tempRoot);
  }
}

function testRunUsesRescannedResultsAfterFix() {
  const content = fs.readFileSync(runPath, 'utf8');
  assert(content.includes('let currentFiles = files;'), 'run.mjs 未引入 currentFiles');
  assert(content.includes('let currentReporter = reporter;'), 'run.mjs 未引入 currentReporter');
  assert(content.includes('currentFiles = rescanned;'), 'run.mjs 未在修复后切换当前文件列表');
  assert(content.includes('currentReporter = rescannedReporter;'), 'run.mjs 未在修复后切换当前报告器');
  assert(content.includes('currentReporter,'), 'run.mjs 写报告时未使用修复后的报告器');
  assert(content.includes('currentFiles.length,'), 'run.mjs 写报告时未使用修复后的文件列表');
  assert(content.includes('return item.reporter.hasErrors() || !item.externalResult.allPassed || verifyFailed;'), 'run.mjs 总体失败判定未覆盖规则错误与外部检查');
  return { name: 'run.mjs 在 --fix 后切换到修复后结果', ok: true };
}

function testDryRunRequiresFix() {
  const content = fs.readFileSync(runPath, 'utf8');
  assert(content.includes('if (args.dryRun && !args.fix) {'), 'run.mjs 缺少 dry-run 参数保护');
  assert(content.includes("console.error('--dry-run 必须搭配 --fix 使用');"), 'run.mjs 缺少 dry-run 提示');
  return { name: '--dry-run 必须搭配 --fix', ok: true };
}

function testFixerRollbackHintIsConservative() {
  const content = fs.readFileSync(fixerPath, 'utf8');
  assert(content.includes("fileURLToPath(import.meta.url)"), 'fixer.mjs 未改为 fileURLToPath');
  assert(!content.includes('git apply -R ${relPatch}'), 'fixer.mjs 仍输出强绑定 git apply 回滚命令');
  assert(content.includes('回滚提示'), 'fixer.mjs 未输出新的回滚提示');
  assert(content.includes('如需回滚，请在合适目录下对该 patch 执行反向应用'), 'fixer.mjs 回滚提示不够保守');
  return { name: 'fixer.mjs 使用保守回滚提示', ok: true };
}

async function main() {
  const tests = [
    testRunUsesRescannedResultsAfterFix,
    testDryRunRequiresFix,
    testFixerRollbackHintIsConservative,
    testFixerPatchPath,
  ];

  const results = [];
  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      console.log(`✓ ${result.name}`);
    } catch (error) {
      results.push({ name: test.name, ok: false, error });
      console.log(`✗ ${test.name}`);
      console.log(`  ${error.message}`);
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  console.log(`结果: ${results.length - failed.length} 通过, ${failed.length} 失败, 共 ${results.length} 项`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
