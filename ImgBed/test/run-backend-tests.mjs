import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const testsDir = path.join(rootDir, 'test');
const filter = process.env.BACKEND_TEST_FILTER || '';

function createTempAppRoot(fileName) {
  const baseDir = path.join(rootDir, '.tmp-backend-tests');
  fs.mkdirSync(baseDir, { recursive: true });
  const sanitized = path.basename(fileName, '.test.mjs').replace(/[^a-zA-Z0-9_-]/g, '-');
  return fs.mkdtempSync(path.join(baseDir, `${sanitized}-`));
}

function cleanupTempAppRoot(appRoot) {
  fs.rmSync(appRoot, { recursive: true, force: true });
}

function getTestFiles() {
  return fs.readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.mjs'))
    .filter((name) => !filter || name.includes(filter))
    .sort();
}

const files = getTestFiles();

for (const file of files) {
  const filePath = path.join(testsDir, file);
  const fileUrl = pathToFileURL(filePath).href;
  const configModuleUrl = pathToFileURL(path.join(rootDir, 'ImgBed', 'src', 'config', 'index.js')).href;
  const appRoot = createTempAppRoot(file);

  try {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import(${JSON.stringify(configModuleUrl)}).then(async (configModule) => { configModule.loadStartupConfig(); await import(${JSON.stringify(fileUrl)}); process.exit(process.exitCode ?? 0); }).catch((err) => { console.error(err); process.exit(1); });`,
    ], {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        IMGBED_APP_ROOT: appRoot,
        TMPDIR: os.tmpdir(),
      },
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } finally {
    cleanupTempAppRoot(appRoot);
  }
}
