import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { ConfigFileError } from '../ImgBed/src/errors/AppError.js';
import { createConfigRepository } from '../ImgBed/src/config/config-loader.js';

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
  const baseDir = path.join(ROOT, '.tmp-config-repo-tests');
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, `${prefix}-`));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJsonConfig(configPath, value) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(value, null, 2), 'utf8');
}

function testRuntimeReadFallsBackToLastKnownGoodConfig() {
  const appRoot = createTempDir('fallback');
  const logger = makeLogger();

  try {
    const repo = createConfigRepository({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('d'.repeat(64)),
      now: () => '2026-04-12T18-33-00',
    });

    const configPath = repo.getConfigPath();
    writeJsonConfig(configPath, {
      server: { port: 13000, host: '0.0.0.0' },
      database: { path: './data/database.sqlite' },
      jwt: { secret: 'x'.repeat(128), expiresIn: '7d' },
      admin: { username: 'admin', password: 'admin' },
      storage: { default: 'local-1', allowedUploadChannels: ['local-1'], storages: [] },
      security: { corsOrigin: '*', guestUploadEnabled: false, uploadPassword: '' },
      upload: { quotaCheckMode: 'auto', fullCheckIntervalHours: 6 },
      performance: {},
    });

    const first = repo.loadStartupConfig();
    fs.writeFileSync(configPath, '{ invalid json', 'utf8');

    const runtimeConfig = repo.readRuntimeConfig();
    assert.deepEqual(runtimeConfig, first);
    assert.equal(repo.getLastKnownGoodConfig().jwt.secret, first.jwt.secret);
    assert.equal(logger.calls.warn.length, 1);
    console.log('  [OK] config-repository: runtime read falls back to last known good config');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function testRuntimeReadThrowsWhenNoSnapshotExists() {
  const appRoot = createTempDir('nosnapshot');
  const logger = makeLogger();

  try {
    const repo = createConfigRepository({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('e'.repeat(64)),
      now: () => '2026-04-12T18-34-00',
    });

    const configPath = repo.getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{ invalid json', 'utf8');

    assert.throws(() => repo.readRuntimeConfig(), (error) => {
      assert.ok(error instanceof ConfigFileError);
      assert.equal(error.kind, 'runtime_invalid');
      assert.equal(error.status, 500);
      return true;
    });
    console.log('  [OK] config-repository: runtime read throws when no valid snapshot exists');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function testWriteRuntimeConfigRefreshesSnapshot() {
  const appRoot = createTempDir('write');
  const logger = makeLogger();

  try {
    const repo = createConfigRepository({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('f'.repeat(64)),
      now: () => '2026-04-12T18-35-00',
    });

    const config = repo.loadStartupConfig();
    const nextConfig = {
      ...config,
      server: { ...config.server, port: 14000 },
    };

    repo.writeRuntimeConfig(nextConfig);

    assert.equal(repo.getLastKnownGoodConfig().server.port, 14000);
    assert.equal(repo.readRuntimeConfig().server.port, 14000);
    console.log('  [OK] config-repository: writeRuntimeConfig refreshes last known good snapshot');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function testRuntimeReadReturnsIsolatedMutableCopy() {
  const appRoot = createTempDir('isolated-copy');
  const logger = makeLogger();

  try {
    const repo = createConfigRepository({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('a'.repeat(64)),
      now: () => '2026-04-12T21-00-00',
    });

    repo.loadStartupConfig();
    const runtimeConfig = repo.readRuntimeConfig();
    const originalSecret = repo.getLastKnownGoodConfig().jwt.secret;

    runtimeConfig.jwt.secret = 'tampered-secret';
    runtimeConfig.server.port = 14001;

    assert.equal(repo.getLastKnownGoodConfig().jwt.secret, originalSecret);
    assert.notEqual(repo.getLastKnownGoodConfig().server.port, 14001);
    console.log('  [OK] config-repository: readRuntimeConfig returns isolated mutable copy');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function testLastKnownGoodConfigIsReadOnlySnapshot() {
  const appRoot = createTempDir('readonly-snapshot');
  const logger = makeLogger();

  try {
    const repo = createConfigRepository({
      appRoot,
      logger,
      randomBytes: () => Buffer.from('b'.repeat(64)),
      now: () => '2026-04-12T21-01-00',
    });

    repo.loadStartupConfig();
    const snapshot = repo.getLastKnownGoodConfig();

    assert.throws(() => {
      snapshot.jwt.secret = 'tampered-secret';
    }, TypeError);
    assert.notEqual(repo.getLastKnownGoodConfig().jwt.secret, 'tampered-secret');
    console.log('  [OK] config-repository: last known good config is read-only');
  } finally {
    cleanupTempDir(appRoot);
  }
}

function main() {
  console.log('running config-repository tests...');
  testRuntimeReadFallsBackToLastKnownGoodConfig();
  testRuntimeReadThrowsWhenNoSnapshotExists();
  testWriteRuntimeConfigRefreshesSnapshot();
  testRuntimeReadReturnsIsolatedMutableCopy();
  testLastKnownGoodConfigIsReadOnlySnapshot();
  console.log('config-repository tests passed');
}

main();
