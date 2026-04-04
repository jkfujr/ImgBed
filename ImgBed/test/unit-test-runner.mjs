/**
 * 后端单元测试运行器模块
 * 供 run.mjs 调用
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 测试文件位于 ImgBed/test 目录
const imgbedRoot = path.resolve(__dirname, '..');
const testDir = __dirname;

const testFiles = [
  'verify-syntax.test.mjs',
  'system-config-fields.test.js',
  'system-services.test.js',
  'update-load-balance.test.js',
  'create-storage-channel.test.js',
  'verify-credentials.test.js',
  'api-tokens-services.test.js',
  'view-services.test.js',
  'view-stream-handling.test.js',
  'directories-services.test.js',
  'files-services.test.js',
  'files-batch-metadata.test.js',
  'upload-services.test.js',
];

function runTest(testFile) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const testPath = path.join(testDir, testFile);

    const child = spawn('node', [testPath], {
      stdio: 'pipe',
      shell: true,
      cwd: imgbedRoot, // 在 ImgBed 目录下运行测试
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({
        file: testFile,
        code,
        duration,
        stdout,
        stderr,
      });
    });
  });
}

export async function runBackendUnitTests() {
  const results = await Promise.all(testFiles.map(runTest));

  let passedCount = 0;
  let failedCount = 0;
  let totalDuration = 0;
  const failedTests = [];

  results.forEach((result) => {
    totalDuration += result.duration;
    if (result.code === 0) {
      passedCount++;
    } else {
      failedCount++;
      failedTests.push({
        file: result.file,
        stderr: result.stderr,
        stdout: result.stdout,
      });
    }
  });

  return {
    total: testFiles.length,
    passed: passedCount,
    failed: failedCount,
    duration: totalDuration,
    passRate: ((passedCount / testFiles.length) * 100).toFixed(1),
    allPassed: failedCount === 0,
    failedTests,
    results,
  };
}

export function printUnitTestResults(result, color = true) {
  const c = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);

  console.log('');
  console.log('backend 单元测试');
  console.log('='.repeat(60));

  result.results.forEach((test) => {
    if (test.code === 0) {
      console.log(`  ${c('32', '✓')} ${test.file} (${test.duration}ms)`);
    } else {
      console.log(`  ${c('31', '✗')} ${test.file} (${test.duration}ms)`);
      if (test.stderr) {
        const lines = test.stderr.split('\n').slice(0, 3);
        lines.forEach((line) => console.log(`    ${c('90', line)}`));
      }
    }
  });

  console.log('-'.repeat(60));
  console.log(`总计: ${result.total} 个测试文件`);
  console.log(`通过: ${c('32', result.passed)} 个`);
  console.log(`失败: ${result.failed > 0 ? c('31', result.failed) : result.failed} 个`);
  console.log(`总耗时: ${result.duration}ms`);
  console.log(`通过率: ${result.passRate}%`);
  console.log('='.repeat(60));
}
