import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function testRunnerUsesTemporaryAppRootIsolation() {
  const source = read('ImgBed/test/run-backend-tests.mjs');

  assert.match(source, /IMGBED_APP_ROOT/);
  assert.match(source, /mkdtempSync|mkdtemp/);
  assert.doesNotMatch(source, /ImgBed', 'data', 'config\.json/);
  console.log('  [OK] run-backend-tests: runner uses isolated app root instead of real data directory');
}

function main() {
  console.log('running run-backend-tests-isolation tests...');
  testRunnerUsesTemporaryAppRootIsolation();
  console.log('run-backend-tests-isolation tests passed');
}

main();
