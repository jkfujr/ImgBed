import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/errors/AppError.js';
import {
  VALID_STORAGE_TYPES,
  applyStorageConfigPatch,
  buildNewStorageChannel,
  validateStorageChannelInput,
} from '../../src/services/system/create-storage-channel.js';
import {
  STORAGE_SENSITIVE_KEYS,
  sanitizeStorageChannel,
  sanitizeSystemConfig,
} from '../../src/services/system/sanitize-system-config.js';
import { createStorageConfigService } from '../../src/services/system/storage-config-service.js';
import { applyStorageFieldUpdates } from '../../src/services/system/update-config-fields.js';
import { updateLoadBalanceConfig } from '../../src/services/system/update-load-balance.js';

function createRuntimeConfig() {
  return {
    storage: {
      default: 's3-1',
      loadBalanceStrategy: 'default',
      storages: [
        {
          id: 's3-1',
          type: 's3',
          name: '主渠道',
          enabled: true,
          allowUpload: true,
          weight: 1,
          config: {
            secretAccessKey: 'secret-1',
            pathStyle: false,
          },
        },
        {
          id: 'local-1',
          type: 'local',
          name: '本地渠道',
          enabled: false,
          allowUpload: false,
          weight: 1,
          config: {
            token: 'token-1',
          },
        },
      ],
    },
  };
}

function createStorageConfigFixture(overrides = {}) {
  let runtimeConfig = structuredClone(overrides.runtimeConfig || createRuntimeConfig());
  const calls = [];
  const appliedConfigs = [];
  const writtenConfigs = [];

  const cacheInvalidation = {
    invalidateStorages() {
      calls.push('invalidateStorages');
    },
    invalidateFiles() {
      calls.push('invalidateFiles');
    },
    invalidateDashboard() {
      calls.push('invalidateDashboard');
    },
  };

  const storageManager = {
    async reload() {
      calls.push('storageManager.reload');
    },
    async testConnection(type, config) {
      calls.push(`testConnection:${type}`);
      return overrides.testConnectionResult || { ok: true, config };
    },
  };

  const service = createStorageConfigService({
    readRuntimeConfig: () => runtimeConfig,
    writeRuntimeConfig: (cfg) => {
      calls.push('writeRuntimeConfig');
      runtimeConfig = structuredClone(cfg);
      writtenConfigs.push(structuredClone(cfg));
    },
    storageManager,
    cacheInvalidation,
    freezeStorageFiles: (storageId) => {
      calls.push(`freeze:${storageId}`);
    },
    updateLoadBalanceConfig,
    applyStorageConfigChange: async ({ cfg }) => {
      calls.push('applyStorageConfigChange');
      appliedConfigs.push(structuredClone(cfg));
    },
    validateStorageChannelInput,
    buildNewStorageChannel,
    applyStorageFieldUpdates,
    applyStorageConfigPatch,
    validStorageTypes: VALID_STORAGE_TYPES,
    preserveNullConfigKeys: STORAGE_SENSITIVE_KEYS,
  });

  return {
    service,
    calls,
    appliedConfigs,
    writtenConfigs,
    getRuntimeConfig() {
      return runtimeConfig;
    },
  };
}

test('sanitizeStorageChannel 与 sanitizeSystemConfig 会共用同一套敏感字段脱敏规则', () => {
  const storage = {
    id: 's3-1',
    type: 's3',
    config: {
      secretAccessKey: 'secret',
      botToken: 'bot',
      token: 'token',
      webhookUrl: 'https://example.com/hook',
      authHeader: 'Bearer token',
      keep: 'safe',
    },
  };

  const maskedStorage = sanitizeStorageChannel(storage);
  const maskedConfig = sanitizeSystemConfig({
    jwt: { secret: 'jwt-secret' },
    admin: { username: 'admin', password: 'plain', passwordHash: 'hash' },
    storage: { storages: [storage] },
  });

  assert.deepEqual(maskedConfig.storage.storages[0], maskedStorage);
  assert.equal(maskedStorage.config.secretAccessKey, '***');
  assert.equal(maskedStorage.config.botToken, '***');
  assert.equal(maskedStorage.config.token, '***');
  assert.equal(maskedStorage.config.webhookUrl, '***');
  assert.equal(maskedStorage.config.authHeader, '***');
  assert.equal(maskedStorage.config.keep, 'safe');
  assert.equal(maskedConfig.jwt.secret, '******');
  assert.equal(maskedConfig.admin.password, undefined);
  assert.equal(maskedConfig.admin.passwordHash, undefined);
});

test('createStorage 会走统一编排链并归一化新渠道配置', async () => {
  const fixture = createStorageConfigFixture();

  const created = await fixture.service.createStorage({
    id: 's3-2',
    type: 's3',
    name: '备份渠道',
    allowUpload: true,
    config: {
      pathStyle: 'true',
      secretAccessKey: 'secret-2',
    },
  });

  assert.equal(created.id, 's3-2');
  assert.equal(created.config.pathStyle, true);
  assert.equal(fixture.appliedConfigs[0].storage.storages.length, 3);
  assert.deepEqual(fixture.calls, [
    'applyStorageConfigChange',
    'invalidateStorages',
  ]);
});

test('updateStorage 会复用字段更新与配置 patch 归一化逻辑', async () => {
  const fixture = createStorageConfigFixture();

  const updated = await fixture.service.updateStorage('s3-1', {
    name: '主渠道-已更新',
    weight: 3,
    config: {
      pathStyle: 'true',
      secretAccessKey: null,
    },
  });

  assert.equal(updated.name, '主渠道-已更新');
  assert.equal(updated.weight, 3);
  assert.equal(updated.config.pathStyle, true);
  assert.equal(updated.config.secretAccessKey, 'secret-1');
  assert.deepEqual(fixture.calls, [
    'applyStorageConfigChange',
    'invalidateStorages',
  ]);
});

test('deleteStorage 会拒绝删除当前默认渠道', async () => {
  const fixture = createStorageConfigFixture();

  await assert.rejects(
    fixture.service.deleteStorage('s3-1'),
    (error) => {
      assert.equal(error instanceof ValidationError, true);
      assert.equal(error.message, '不能删除当前默认渠道，请先切换默认渠道');
      return true;
    },
  );
});

test('deleteStorage 会按 freeze -> apply -> invalidate 顺序执行统一编排', async () => {
  const runtimeConfig = createRuntimeConfig();
  runtimeConfig.storage.default = 's3-1';

  const fixture = createStorageConfigFixture({ runtimeConfig });

  await fixture.service.deleteStorage('local-1');

  assert.deepEqual(fixture.calls, [
    'freeze:local-1',
    'applyStorageConfigChange',
    'invalidateStorages',
    'invalidateFiles',
    'invalidateDashboard',
  ]);
  assert.equal(fixture.appliedConfigs[0].storage.storages.length, 1);
  assert.equal(fixture.appliedConfigs[0].storage.storages[0].id, 's3-1');
});

test('setDefaultStorage 与 toggleStorage 会复用统一写回链', async () => {
  const defaultFixture = createStorageConfigFixture();
  await defaultFixture.service.setDefaultStorage('local-1');

  assert.equal(defaultFixture.getRuntimeConfig().storage.default, 'local-1');
  assert.deepEqual(defaultFixture.calls, [
    'applyStorageConfigChange',
    'invalidateStorages',
  ]);

  const toggleFixture = createStorageConfigFixture();
  const enabled = await toggleFixture.service.toggleStorage('local-1');

  assert.equal(enabled, true);
  assert.equal(toggleFixture.getRuntimeConfig().storage.storages[1].enabled, true);
  assert.deepEqual(toggleFixture.calls, [
    'applyStorageConfigChange',
    'invalidateStorages',
  ]);
});

test('updateLoadBalance 会拒绝非法策略，并在合法输入时写回重载', async () => {
  const invalidFixture = createStorageConfigFixture();

  await assert.rejects(
    invalidFixture.service.updateLoadBalance({ strategy: 'unsupported' }),
    (error) => {
      assert.equal(error instanceof ValidationError, true);
      assert.equal(error.message, '无效的策略: unsupported');
      return true;
    },
  );

  const validFixture = createStorageConfigFixture();
  await validFixture.service.updateLoadBalance({
    strategy: 'weighted',
    scope: 'byType',
    enabledTypes: ['s3'],
    weights: { 's3-1': 9 },
    failoverEnabled: false,
  });

  assert.equal(validFixture.writtenConfigs[0].storage.loadBalanceStrategy, 'weighted');
  assert.deepEqual(validFixture.calls, [
    'writeRuntimeConfig',
    'storageManager.reload',
    'invalidateStorages',
  ]);
});
