import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const testsDir = path.join(rootDir, 'test');

const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

for (const file of files) {
  const filePath = path.join(testsDir, file);
  const fileUrl = pathToFileURL(filePath).href;
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import(${JSON.stringify(fileUrl)}).then(() => process.exit(process.exitCode ?? 0)).catch((err) => { console.error(err); process.exit(1); });`,
  ], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
