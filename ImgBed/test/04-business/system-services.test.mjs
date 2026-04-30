import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictError, ValidationError } from '../../src/errors/AppError.js';
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
import { createSystemConfigService } from '../../src/services/system/system-config-service.js';
import { createMaintenanceService } from '../../src/services/system/maintenance-service.js';
import { createStorageConfigService } from '../../src/services/system/storage-config-service.js';
import {
  applyStorageFieldUpdates,
  applySystemConfigUpdates,
} from '../../src/services/system/update-config-fields.js';
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

  const storageManager = {
    async reload() {
      calls.push('storageManager.reload');
    },
    async testConnection(type, config) {
      calls.push(`testConnection:${type}`);
      return overrides.testConnectionResult || { ok: true, config };
    },
    async hasExistingObjects(type, config) {
      calls.push(`hasExistingObjects:${type}`);
      if (typeof overrides.hasExistingObjects === 'function') {
        return overrides.hasExistingObjects(type, config);
      }
      return overrides.hasExistingObjectsResult || false;
    },
    async inspectExistingObjects(type, config) {
      calls.push(`inspectExistingObjects:${type}`);
      if (typeof overrides.inspectExistingObjects === 'function') {
        return overrides.inspectExistingObjects(type, config);
      }
      if (overrides.inspectExistingObjectsResult) {
        return overrides.inspectExistingObjectsResult;
      }
      const hasObjects = overrides.hasExistingObjectsResult || false;
      return {
        hasObjects,
        sampleLimit: 0,
        isTruncated: hasObjects,
        items: [],
      };
    },
    async clearStorageContents(type, config) {
      calls.push(`clearStorageContents:${type}`);
      if (typeof overrides.clearStorageContents === 'function') {
        return overrides.clearStorageContents(type, config);
      }
      return overrides.clearStorageContentsResult || { deletedCount: 0 };
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
    invalidateStorageCaches: () => {
      calls.push('invalidateStorages');
    },
    updateLoadBalanceConfig,
    applyStorageConfigChange: async ({ cfg }) => {
      calls.push('applyStorageConfigChange');
      appliedConfigs.push(structuredClone(cfg));
    },
    storageDeleteFilesTaskService: {
      assertCanStartStorageDeleteFilesTask(payload) {
        calls.push({ assertCanStartStorageDeleteFilesTask: payload });
        if (payload.fileAction !== 'freeze' && payload.fileAction !== 'delete_records') {
          throw new ValidationError('file_action 参数必须是 freeze 或 delete_records');
        }
        return payload.fileAction;
      },
      startStorageDeleteFilesTask(payload) {
        calls.push({ startStorageDeleteFilesTask: payload });
        if (typeof overrides.startStorageDeleteFilesTask === 'function') {
          return overrides.startStorageDeleteFilesTask(payload);
        }
        return {
          taskId: 'task-delete-files-1',
          status: 'processing',
          fileAction: payload.fileAction,
        };
      },
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
    security: { guestUploadTicketRevision: 'revision-secret' },
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
  assert.equal(maskedConfig.security.guestUploadTicketRevision, undefined);
});

test('createSystemConfigService 会写回配置并触发系统配置缓存失效', () => {
  const calls = [];
  let runtimeConfig = {
    server: {
      port: 3000,
    },
  };

  const service = createSystemConfigService({
    readRuntimeConfig: () => runtimeConfig,
    writeRuntimeConfig: (config) => {
      calls.push('writeRuntimeConfig');
      runtimeConfig = structuredClone(config);
    },
    invalidateSystemConfigCache: () => {
      calls.push('invalidateSystemConfigCache');
    },
    applySystemConfigUpdates: (config, body) => {
      calls.push({ body });
      config.server = {
        ...(config.server || {}),
        ...(body.server || {}),
      };
    },
  });

  service.updateConfig({
    server: {
      port: 15000,
    },
  });

  assert.equal(runtimeConfig.server.port, 15000);
  assert.deepEqual(calls, [
    {
      body: {
        server: {
          port: 15000,
        },
      },
    },
    'writeRuntimeConfig',
    'invalidateSystemConfigCache',
  ]);
});

test('applySystemConfigUpdates 会更新文件目录路径长度限制', () => {
  const config = {};

  applySystemConfigUpdates(config, {
    files: {
      maxDirectoryPathLength: '2048',
    },
  });

  assert.equal(config.files.maxDirectoryPathLength, 2048);

  applySystemConfigUpdates(config, {
    files: {
      maxDirectoryPathLength: '0',
    },
  });

  assert.equal(config.files.maxDirectoryPathLength, 4096);
});

test('applySystemConfigUpdates 会在访客上传密码变化时轮换票据 revision', () => {
  const config = {
    security: {
      uploadPassword: 'old-password',
      guestUploadTicketRevision: 'old-revision',
    },
  };

  applySystemConfigUpdates(config, {
    security: {
      corsOrigin: 'https://example.com',
    },
  });
  assert.equal(config.security.guestUploadTicketRevision, 'old-revision');

  applySystemConfigUpdates(config, {
    security: {
      uploadPassword: 'old-password',
    },
  });
  assert.equal(config.security.guestUploadTicketRevision, 'old-revision');

  applySystemConfigUpdates(config, {
    security: {
      uploadPassword: 'new-password',
    },
  });
  assert.equal(config.security.uploadPassword, 'new-password');
  assert.equal(config.security.guestUploadTicketRevision.length, 32);
  assert.notEqual(config.security.guestUploadTicketRevision, 'old-revision');
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
    'inspectExistingObjects:s3',
    'applyStorageConfigChange',
    'invalidateStorages',
  ]);
});

test('createStorage 在 S3 bucket 非空且未指定动作时会返回带 reason 的冲突错误', async () => {
  const fixture = createStorageConfigFixture({
    inspectExistingObjectsResult: {
      hasObjects: true,
      sampleLimit: 20,
      isTruncated: false,
      items: [
        {
          key: 'demo.png',
          size: 123,
          lastModified: '2026-04-30T00:00:00.000Z',
        },
      ],
    },
  });

  await assert.rejects(
    fixture.service.createStorage({
      id: 's3-2',
      type: 's3',
      name: '备份渠道',
      allowUpload: true,
      config: {
        bucket: 'bucket-1',
      },
    }),
    (error) => {
      assert.equal(error instanceof ConflictError, true);
      assert.equal(error.message, 'S3 存储桶中已存在文件，请确认是否需要清空');
      assert.equal(error.reason, 'S3_BUCKET_NOT_EMPTY');
      assert.deepEqual(error.details.existingObjects.items, [
        {
          key: 'demo.png',
          size: 123,
          lastModified: '2026-04-30T00:00:00.000Z',
        },
      ]);
      return true;
    },
  );

  assert.deepEqual(fixture.calls, [
    'inspectExistingObjects:s3',
  ]);
});

test('createStorage 在选择 keep 时会保留已有对象并继续创建', async () => {
  const fixture = createStorageConfigFixture({
    hasExistingObjectsResult: true,
  });

  const created = await fixture.service.createStorage({
    id: 's3-2',
    type: 's3',
    name: '备份渠道',
    allowUpload: true,
    s3NonEmptyAction: 'keep',
    config: {
      bucket: 'bucket-1',
      secretAccessKey: 'secret-2',
    },
  });

  assert.equal(created.id, 's3-2');
  assert.deepEqual(fixture.calls, [
    'inspectExistingObjects:s3',
    'applyStorageConfigChange',
    'invalidateStorages',
  ]);
});

test('createStorage 在选择 clear_bucket 时会先清空整个 bucket 再创建', async () => {
  const fixture = createStorageConfigFixture({
    hasExistingObjectsResult: true,
  });

  const created = await fixture.service.createStorage({
    id: 's3-2',
    type: 's3',
    name: '备份渠道',
    allowUpload: true,
    s3NonEmptyAction: 'clear_bucket',
    config: {
      bucket: 'bucket-1',
      secretAccessKey: 'secret-2',
    },
  });

  assert.equal(created.id, 's3-2');
  assert.deepEqual(fixture.calls, [
    'inspectExistingObjects:s3',
    'clearStorageContents:s3',
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
    fixture.service.deleteStorage('s3-1', { fileAction: 'freeze' }),
    (error) => {
      assert.equal(error instanceof ValidationError, true);
      assert.equal(error.message, '不能删除当前默认渠道，请先切换默认渠道');
      return true;
    },
  );

  assert.deepEqual(fixture.calls, []);
});

test('deleteStorage 会删除渠道配置并启动自动文件处理任务', async () => {
  const runtimeConfig = createRuntimeConfig();
  runtimeConfig.storage.default = 's3-1';

  const fixture = createStorageConfigFixture({ runtimeConfig });

  const result = await fixture.service.deleteStorage('local-1', { fileAction: 'freeze' });

  assert.deepEqual(fixture.calls, [
    {
      assertCanStartStorageDeleteFilesTask: {
        sourceStorageId: 'local-1',
        fileAction: 'freeze',
      },
    },
    'applyStorageConfigChange',
    'invalidateStorages',
    {
      startStorageDeleteFilesTask: {
        sourceStorageId: 'local-1',
        fileAction: 'freeze',
      },
    },
  ]);
  assert.deepEqual(result, {
    taskId: 'task-delete-files-1',
    status: 'processing',
    fileAction: 'freeze',
  });
  assert.equal(fixture.appliedConfigs[0].storage.storages.length, 1);
  assert.equal(fixture.appliedConfigs[0].storage.storages[0].id, 's3-1');
});

test('deleteStorage 会在非法 fileAction 时拒绝且不写配置', async () => {
  const fixture = createStorageConfigFixture();

  await assert.rejects(
    fixture.service.deleteStorage('local-1', { fileAction: 'bad-action' }),
    (error) => {
      assert.equal(error instanceof ValidationError, true);
      assert.equal(error.message, 'file_action 参数必须是 freeze 或 delete_records');
      return true;
    },
  );

  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.getRuntimeConfig().storage.storages.length, 2);
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

test('createMaintenanceService 会通过统一执行器启动容量校正任务', () => {
  const calls = [];
  const service = createMaintenanceService({
    db: {
      prepare() {
        return {
          all() {
            return [];
          },
        };
      },
    },
    storageManager: {},
    logger: {
      info(message) {
        calls.push({ type: 'info', message });
      },
    },
    taskExecutor: {
      registerTask(taskDefinition) {
        calls.push({ type: 'register', taskName: taskDefinition.name });
      },
      start(taskName) {
        calls.push({ type: 'start', taskName });
      },
    },
    rebuildQuotaStatsTaskDefinition: {
      name: 'rebuild-quota-stats',
      async run() {},
    },
  });

  const result = service.triggerQuotaStatsRebuild();

  assert.deepEqual(result, { status: 'processing' });
  assert.deepEqual(calls, [
    { type: 'register', taskName: 'rebuild-quota-stats' },
    { type: 'info', message: '手动触发容量校正任务' },
    { type: 'start', taskName: 'rebuild-quota-stats' },
  ]);
});
