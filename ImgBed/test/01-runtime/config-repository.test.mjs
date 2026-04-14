import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ConfigFileError } from '../../src/errors/AppError.js';
import { buildDefaultConfig, createConfigRepository } from '../../src/config/config-loader.js';
import {
  cleanupPath,
  createLoggerDouble,
  createTempAppRoot,
} from '../helpers/runtime-test-helpers.mjs';

function createRepositoryFixture() {
  const appRoot = createTempAppRoot('imgbed-config-');
  const loggerDouble = createLoggerDouble();
  const clock = { now: 0 };
  const repository = createConfigRepository({
    appRoot,
    logger: loggerDouble.logger,
    randomBytes: () => Buffer.alloc(64, 0x12),
    cacheTtlMs: 10,
    dateNow: () => clock.now,
  });

  return {
    appRoot,
    clock,
    loggerDouble,
    repository,
    configPath: path.join(appRoot, 'data', 'config.json'),
  };
}

test('loadStartupConfig 会创建默认配置并建立最近一次有效快照', (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => cleanupPath(fixture.appRoot));

  const startupConfig = fixture.repository.loadStartupConfig();
  const lastKnownGood = fixture.repository.getLastKnownGoodConfig();

  assert.equal(fs.existsSync(fixture.configPath), true);
  assert.equal(startupConfig.storage.default, 'local-1');
  assert.equal(startupConfig.jwt.secret.length, 128);
  assert.equal(startupConfig.admin.password, undefined);
  assert.equal(typeof startupConfig.admin.passwordHash, 'string');
  assert.equal(lastKnownGood.jwt.secret, startupConfig.jwt.secret);
  assert.equal(fixture.loggerDouble.records.info.length >= 2, true);
});

test('readRuntimeConfig 返回克隆副本且在文件损坏时回退到最近一次有效配置', (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => cleanupPath(fixture.appRoot));

  const startupConfig = fixture.repository.loadStartupConfig();
  const runtimeConfig = fixture.repository.readRuntimeConfig();
  runtimeConfig.admin.username = 'mutated-admin';

  const secondRead = fixture.repository.readRuntimeConfig();
  assert.equal(secondRead.admin.username, 'admin');

  fixture.clock.now = 20;
  fs.writeFileSync(fixture.configPath, '{', 'utf8');
  const fallbackConfig = fixture.repository.readRuntimeConfig();

  assert.equal(fallbackConfig.jwt.secret, startupConfig.jwt.secret);
  assert.equal(fixture.loggerDouble.records.warn.length, 1);
});

test('writeRuntimeConfig 会持久化配置并刷新最近一次有效快照', (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => cleanupPath(fixture.appRoot));

  const startupConfig = fixture.repository.loadStartupConfig();
  const nextConfig = {
    ...startupConfig,
    jwt: {
      ...startupConfig.jwt,
      secret: 'next-secret-value',
    },
    security: {
      ...startupConfig.security,
      corsOrigin: 'https://example.com',
    },
    admin: {
      ...startupConfig.admin,
      username: 'next-admin',
      password: 'next-password',
    },
  };

  const writtenConfig = fixture.repository.writeRuntimeConfig(nextConfig);
  const persistedConfig = JSON.parse(fs.readFileSync(fixture.configPath, 'utf8'));

  assert.equal(writtenConfig.jwt.secret, 'next-secret-value');
  assert.equal(persistedConfig.security.corsOrigin, 'https://example.com');
  assert.equal(writtenConfig.admin.username, 'next-admin');
  assert.equal(writtenConfig.admin.password, undefined);
  assert.equal(typeof writtenConfig.admin.passwordHash, 'string');
  assert.equal(persistedConfig.admin.password, undefined);
  assert.equal(typeof persistedConfig.admin.passwordHash, 'string');
  assert.equal(fixture.repository.getLastKnownGoodConfig().jwt.secret, 'next-secret-value');
});

test('loadStartupConfig 会自动迁移旧版管理员明文密码配置', (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => cleanupPath(fixture.appRoot));

  fs.mkdirSync(path.dirname(fixture.configPath), { recursive: true });
  fs.writeFileSync(fixture.configPath, JSON.stringify({
    ...buildDefaultConfig({
      jwtSecret: 'legacy-secret',
      randomBytes: () => Buffer.alloc(16, 0x22),
    }),
    admin: {
      username: 'legacy-admin',
      password: 'legacy-password',
    },
  }, null, 2), 'utf8');

  const startupConfig = fixture.repository.loadStartupConfig();
  const persistedConfig = JSON.parse(fs.readFileSync(fixture.configPath, 'utf8'));

  assert.equal(startupConfig.admin.username, 'legacy-admin');
  assert.equal(startupConfig.admin.password, undefined);
  assert.equal(typeof startupConfig.admin.passwordHash, 'string');
  assert.equal(persistedConfig.admin.password, undefined);
  assert.equal(typeof persistedConfig.admin.passwordHash, 'string');
  assert.equal(fixture.loggerDouble.records.info.some((args) => String(args[1]).includes('自动迁移为哈希存储')), true);
});

test('缺少 jwt.secret 时会抛出 ConfigFileError', (t) => {
  const fixture = createRepositoryFixture();
  t.after(() => cleanupPath(fixture.appRoot));

  fixture.repository.loadStartupConfig();

  assert.throws(() => {
    fixture.repository.writeRuntimeConfig({
      server: { port: 13000 },
      jwt: {
        secret: '',
      },
    });
  }, (error) => {
    assert.equal(error instanceof ConfigFileError, true);
    assert.match(error.message, /jwt\.secret/);
    return true;
  });
});
