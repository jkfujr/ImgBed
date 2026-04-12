import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfigFile } from '../ImgBed/src/config/config-loader.js';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function makeLogger() {
  const calls = { info: [], warn: [], error: [] };
  return {
    calls,
    info(...args) { calls.info.push(args); },
    warn(...args) { calls.warn.push(args); },
    error(...args) { calls.error.push(args); },
  };
}

function createTempDir(prefix) {
  const baseDir = path.join(ROOT, '.tmp-config-tests');
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, `${prefix}-`));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function testCreatesDefaultConfigWhenMissing() {
  const appRoot = createTempDir('create');
  const logger = makeLogger();

  try {
    const config = loadConfigFile({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('a'.repeat(64)),
      now: () => '2026-04-12T18-30-00',
    });

    const configPath = path.join(appRoot, 'data', 'config.json');
    assert.ok(fs.existsSync(configPath));
    assert.equal(config.server.port, 13000);
    assert.equal(config.storage.default, 'local-1');
    assert.equal(config.jwt.secret.length, 128);
    assert.equal(logger.calls.info.length, 2);
    console.log('  [OK] config-loader: missing config file is created with defaults');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function testRepairsInvalidConfigByBackingItUp() {
  const appRoot = createTempDir('repair');
  const dataRoot = path.join(appRoot, 'data');
  const configPath = path.join(dataRoot, 'config.json');
  const logger = makeLogger();

  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(configPath, '{ invalid json', 'utf8');

    const config = loadConfigFile({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('b'.repeat(64)),
      now: () => '2026-04-12T18-31-00',
    });

    const backupPath = `${configPath}.invalid-2026-04-12T18-31-00`;
    assert.ok(fs.existsSync(backupPath));
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '{ invalid json');
    assert.equal(config.jwt.secret.length, 128);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(configPath, 'utf8')));
    assert.equal(logger.calls.warn.length, 1);
    console.log('  [OK] config-loader: invalid config is backed up and regenerated');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function main() {
  console.log('running config-loader tests...');
  testCreatesDefaultConfigWhenMissing();
  testRepairsInvalidConfigByBackingItUp();
  console.log('config-loader tests passed');
}

main();
