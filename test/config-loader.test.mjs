import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { ConfigFileError } from '../ImgBed/src/errors/AppError.js';
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

    const backupPath = `${configPath}.invalid-2026-04-12T18-31-00`;
    assert.throws(() => loadConfigFile({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('b'.repeat(64)),
      now: () => '2026-04-12T18-31-00',
    }), (error) => {
      assert.ok(error instanceof ConfigFileError);
      assert.equal(error.kind, 'invalid_existing');
      assert.equal(error.configPath, configPath);
      assert.equal(error.backupPath, backupPath);
      assert.equal(error.cause?.name, 'SyntaxError');
      return true;
    });

    assert.ok(fs.existsSync(backupPath));
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '{ invalid json');
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{ invalid json');
    assert.equal(logger.calls.warn.length, 0);
    console.log('  [OK] config-loader: invalid config is backed up and startup fails without overwriting it');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function testSupportsUtf8BomConfig() {
  const appRoot = createTempDir('bom');
  const dataRoot = path.join(appRoot, 'data');
  const configPath = path.join(dataRoot, 'config.json');
  const logger = makeLogger();

  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(configPath, '\uFEFF{"server":{"port":14000},"storage":{"default":"local-1"}}', 'utf8');

    const config = loadConfigFile({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('c'.repeat(64)),
      now: () => '2026-04-12T18-32-00',
    });

    assert.equal(config.server.port, 14000);
    assert.equal(config.storage.default, 'local-1');
    assert.equal(logger.calls.warn.length, 0);
    console.log('  [OK] config-loader: UTF-8 BOM config is parsed correctly');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function main() {
  console.log('running config-loader tests...');
  testCreatesDefaultConfigWhenMissing();
  testRepairsInvalidConfigByBackingItUp();
  testSupportsUtf8BomConfig();
  console.log('config-loader tests passed');
}

main();
