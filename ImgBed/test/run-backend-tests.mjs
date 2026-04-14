import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const testRoot = path.dirname(currentFile);
const projectRoot = path.resolve(testRoot, '..');

function collectTestFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = collectTestFiles(testRoot).sort();

if (testFiles.length === 0) {
  console.error('未找到可执行的后端测试文件');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
