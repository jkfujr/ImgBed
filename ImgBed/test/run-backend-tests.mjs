#!/usr/bin/env node
/**
 * ImgBed 后端单元测试运行器
 * 整合所有后端服务层和路由层的单元测试
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    const testPath = join(__dirname, testFile);

    const child = spawn('node', [testPath], {
      stdio: 'pipe',
      shell: true,
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

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    ImgBed 后端单元测试套件                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log(`\n开始运行 ${testFiles.length} 个测试文件...\n`);

  const results = await Promise.all(testFiles.map(runTest));

  let passedCount = 0;
  let failedCount = 0;
  let totalDuration = 0;

  results.forEach((result) => {
    totalDuration += result.duration;

    if (result.code === 0) {
      passedCount++;
      console.log(`✅ ${result.file} (${result.duration}ms)`);
      if (result.stdout && !result.stdout.includes('tests') && result.stdout.trim()) {
        console.log(`   ${result.stdout.trim()}`);
      }
    } else {
      failedCount++;
      console.log(`❌ ${result.file} (${result.duration}ms)`);
      if (result.stderr) {
        console.log(`   错误: ${result.stderr.trim()}`);
      }
      if (result.stdout) {
        console.log(`   输出: ${result.stdout.trim()}`);
      }
    }
  });

  console.log('\n========================================');
  console.log(`总计: ${testFiles.length} 个测试文件`);
  console.log(`通过: ${passedCount} 个`);
  console.log(`失败: ${failedCount} 个`);
  console.log(`总耗时: ${totalDuration}ms`);
  console.log(`通过率: ${((passedCount / testFiles.length) * 100).toFixed(1)}%`);
  console.log('========================================\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('运行测试时出错:', err);
  process.exit(1);
});
