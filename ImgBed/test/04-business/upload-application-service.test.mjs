import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLoggerDouble,
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-upload-app-service-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { createUploadApplicationService } = await import(resolveProjectModuleUrl('src', 'services', 'upload', 'upload-application-service.js'));
const { prepareUploadFile } = await import(resolveProjectModuleUrl('src', 'services', 'upload', 'prepare-upload-file.js'));

function createUploadFixture() {
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5mG9sAAAAASUVORK5CYII=', 'base64');

  return {
    originalname: 'demo.png',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
  };
}

function createServiceHarness(overrides = {}) {
  const calls = [];
  const { logger, records } = createLoggerDouble();
  const captured = {};
  const file = createUploadFixture();

  const service = createUploadApplicationService({
    db: 'mock-db',
    logger,
    storageManager: {
      isUploadAllowed(channelId) {
        calls.push(`quota:${channelId}`);
        return true;
      },
      getStorageMeta() {
        return { type: 'local' };
      },
    },
    applyPendingQuotaEvents(options) {
      calls.push('apply-quota-events');
      captured.applyQuotaEventsOptions = options;
      return {
        applied: 1,
        storageIds: ['local-1'],
      };
    },
    getConfig() {
      calls.push('get-config');
      return {
        storage: {
          failoverEnabled: true,
          loadBalanceStrategy: 'default',
        },
      };
    },
    resolveUploadChannel(body, _storageManager, _config) {
      calls.push('resolve-channel');
      captured.resolveBody = body;
      return { channelId: 'local-1' };
    },
    validateUploadFile(inputFile) {
      calls.push('validate-file');
      assert.equal(inputFile.originalname, 'demo.png');
    },
    normalizeUploadDirectory(directory) {
      calls.push('normalize-directory');
      assert.equal(directory, '/gallery');
      return '/gallery';
    },
    prepareUploadFile: async () => {
      calls.push('prepare-file');
      return {
        buffer: Buffer.from('remote'),
        originalName: 'demo.png',
        fileId: '0123456789ab_demo.png',
        newFileName: '0123456789ab_demo.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        exif: '{"width":1}',
      };
    },
    createStorageOperationLifecycle(options) {
      calls.push('create-lifecycle');
      captured.lifecycleOptions = options;
      return {
        operationId: 'op-1',
        markRemoteDone(payload) {
          calls.push('mark-remote-done');
          captured.remoteDonePayload = payload;
        },
        async commit(payload) {
          calls.push('commit');
          captured.commitPayload = payload;
          payload.persist();
        },
      };
    },
    executeUploadWithFailover: async (options) => {
      calls.push('execute-upload');
      captured.uploadOptions = options;
      return {
        finalChannelId: 'backup-1',
        failedChannels: [{ id: 'local-1', error: 'timeout' }],
        storageResult: {
          storageKey: 'remote-key',
          size: 8,
          deleteToken: { token: 'delete-1' },
        },
        isChunked: 1,
        chunkCount: 2,
        chunkRecords: [{ chunk_index: 0 }, { chunk_index: 1 }],
      };
    },
    buildStoragePayloadFromStorageResult(result, options) {
      calls.push('build-remote-payload');
      captured.remotePayloadOptions = { result, options };
      return {
        storageKey: result.storageKey,
        isChunked: options.isChunked,
      };
    },
    resolveStoredFileSize(storageResult, fallbackSize) {
      calls.push('resolve-size');
      captured.resolveSizeArgs = { storageResult, fallbackSize };
      return 8;
    },
    buildUploadRecord(input) {
      calls.push('build-record');
      captured.buildRecordInput = input;
      return {
        id: input.fileId,
        storage_key: input.storageResult.storageKey,
      };
    },
    insertFile(db, record) {
      calls.push('insert-file');
      captured.insertFile = { db, record };
    },
    insertChunks(chunkRecords, db) {
      calls.push('insert-chunks');
      captured.insertChunks = { chunkRecords, db };
    },
    buildQuotaEvent(payload) {
      calls.push('build-quota-event');
      captured.quotaEventPayload = payload;
      return { id: 'quota-event-1' };
    },
    buildStorageArtifactPayload(payload) {
      calls.push('build-cleanup-payload');
      captured.cleanupPayloadInput = payload;
      return {
        ...payload,
        normalized: true,
      };
    },
    removeStoredArtifacts: async (payload) => {
      calls.push('cleanup-remote');
      captured.cleanupRemotePayload = payload;
    },
    cacheInvalidation: {
      invalidateFiles() {
        calls.push('invalidate-files');
      },
      invalidateStorages() {
        calls.push('invalidate-storages');
      },
    },
    ...overrides,
  });

  return {
    calls,
    captured,
    file,
    records,
    service,
  };
}

test('createUploadApplicationService 会按既有顺序完成上传编排并返回当前响应契约', async () => {
  const harness = createServiceHarness();

  const result = await harness.service.handleUpload({
    body: {
      directory: '/gallery',
      tags: 'cover,banner',
      is_public: '1',
    },
    file: harness.file,
    auth: {
      type: 'guest',
      username: 'guest-user',
    },
    clientIp: '203.0.113.10',
  });

  assert.deepEqual(result, {
    data: {
      id: '0123456789ab_demo.png',
      url: '/0123456789ab_demo.png',
      file_name: '0123456789ab_demo.png',
      original_name: 'demo.png',
      size: 8,
      width: 1,
      height: 1,
      failover: {
        retries: 1,
        failed: ['local-1'],
        final_channel: 'backup-1',
      },
    },
    message: '文件上传成功（经过 1 次渠道切换）',
  });

  assert.ok(harness.calls.indexOf('resolve-channel') < harness.calls.indexOf('execute-upload'));
  assert.ok(harness.calls.indexOf('execute-upload') < harness.calls.indexOf('mark-remote-done'));
  assert.ok(harness.calls.indexOf('mark-remote-done') < harness.calls.indexOf('commit'));
  assert.ok(harness.calls.indexOf('commit') < harness.calls.indexOf('invalidate-files'));
  assert.ok(harness.calls.indexOf('invalidate-files') < harness.calls.indexOf('invalidate-storages'));

  assert.equal(harness.captured.resolveBody.directory, '/gallery');
  assert.equal(harness.captured.lifecycleOptions.operationType, 'upload');
  assert.equal(harness.captured.lifecycleOptions.fileId, '0123456789ab_demo.png');
  assert.equal(harness.captured.uploadOptions.initialChannelId, 'local-1');
  assert.equal(harness.captured.remoteDonePayload.targetStorageId, 'backup-1');
  assert.deepEqual(harness.captured.remoteDonePayload.remotePayload, {
    storageKey: 'remote-key',
    isChunked: true,
  });
  assert.equal(harness.captured.resolveSizeArgs.fallbackSize, harness.file.size);
  assert.equal(harness.captured.buildRecordInput.directory, '/gallery');
  assert.equal(harness.captured.buildRecordInput.finalChannelId, 'backup-1');
  assert.equal(harness.captured.buildRecordInput.fileSize, 8);
  assert.equal(harness.captured.buildRecordInput.clientIp, '203.0.113.10');
  assert.deepEqual(harness.captured.insertFile, {
    db: 'mock-db',
    record: {
      id: '0123456789ab_demo.png',
      storage_key: 'remote-key',
    },
  });
  assert.deepEqual(harness.captured.insertChunks, {
    chunkRecords: [{ chunk_index: 0 }, { chunk_index: 1 }],
    db: 'mock-db',
  });
  assert.equal(harness.captured.quotaEventPayload.storageId, 'backup-1');
  assert.deepEqual(harness.captured.commitPayload.quotaEvents, [{ id: 'quota-event-1' }]);
  assert.deepEqual(harness.captured.commitPayload.failureCompensationPayload, {
    storageKey: 'remote-key',
    deleteToken: { token: 'delete-1' },
    isChunked: true,
    chunkRecords: [{ chunk_index: 0 }, { chunk_index: 1 }],
    normalized: true,
  });
  assert.equal(harness.records.error.length, 0);
});

test('createUploadApplicationService 在 commit 失败时会记录错误并原样抛出', async () => {
  const commitError = new Error('commit failed');
  const harness = createServiceHarness({
    createStorageOperationLifecycle() {
      return {
        operationId: 'op-fail',
        markRemoteDone() {},
        async commit() {
          throw commitError;
        },
      };
    },
    cacheInvalidation: {
      invalidateFiles() {
        throw new Error('不应执行到缓存失效');
      },
      invalidateStorages() {
        throw new Error('不应执行到缓存失效');
      },
    },
  });

  await assert.rejects(() => harness.service.handleUpload({
    body: { directory: '/gallery' },
    file: harness.file,
    auth: { type: 'guest', username: 'guest-user' },
    clientIp: '203.0.113.11',
  }), (error) => error === commitError);

  assert.equal(harness.records.error.length, 1);
  assert.equal(harness.records.error[0][0].operationId, 'op-fail');
});

test('createUploadApplicationService 的失败补偿会以 getStorage 窄依赖调用远端清理', async () => {
  const harness = createServiceHarness({
    storageManager: {
      isUploadAllowed() {
        return true;
      },
      getStorageMeta() {
        return { type: 'local' };
      },
      getStorage(storageId) {
        return { id: storageId };
      },
    },
    createStorageOperationLifecycle() {
      return {
        operationId: 'op-compensation',
        markRemoteDone() {},
        async commit(payload) {
          await payload.executeCompensation();
        },
      };
    },
  });

  await harness.service.handleUpload({
    body: { directory: '/gallery' },
    file: harness.file,
    auth: { type: 'guest', username: 'guest-user' },
    clientIp: '203.0.113.13',
  });

  assert.equal(typeof harness.captured.cleanupRemotePayload.getStorage, 'function');
  assert.equal(harness.captured.cleanupRemotePayload.storageId, 'backup-1');
  assert.equal(harness.captured.cleanupRemotePayload.storageKey, 'remote-key');
  assert.deepEqual(harness.captured.cleanupRemotePayload.deleteToken, { token: 'delete-1' });
  assert.equal(harness.captured.cleanupRemotePayload.isChunked, true);
});

test('createUploadApplicationService 在元数据提取失败时只记 warn 并继续上传', async () => {
  const { logger, records } = createLoggerDouble();
  const file = createUploadFixture();
  const service = createUploadApplicationService({
    logger,
    db: 'mock-db',
    storageManager: {
      isUploadAllowed() {
        return true;
      },
      getStorageMeta() {
        return { type: 'local' };
      },
    },
    getConfig() {
      return {
        storage: {
          failoverEnabled: true,
          loadBalanceStrategy: 'default',
        },
      };
    },
    resolveUploadChannel() {
      return { channelId: 'local-1' };
    },
    normalizeUploadDirectory() {
      return '/gallery';
    },
    prepareUploadFile(inputFile) {
      return prepareUploadFile(inputFile, {
        logger,
        readImageMetadataFn: async () => {
          throw new Error('sharp failed');
        },
      });
    },
    createStorageOperationLifecycle() {
      return {
        operationId: 'op-meta',
        markRemoteDone() {},
        async commit({ persist }) {
          persist();
        },
      };
    },
    executeUploadWithFailover: async ({ fileId, newFileName, originalName, mimeType, buffer }) => ({
      finalChannelId: 'local-1',
      failedChannels: [],
      storageResult: {
        storageKey: fileId,
        size: buffer.length,
        deleteToken: null,
      },
      isChunked: 0,
      chunkCount: 0,
      chunkRecords: [],
      newFileName,
      originalName,
      mimeType,
    }),
    insertFile() {},
    insertChunks() {},
    buildQuotaEvent() {
      return { id: 'quota-meta' };
    },
    cacheInvalidation: {
      invalidateFiles() {},
      invalidateStorages() {},
    },
  });

  const result = await service.handleUpload({
    body: { directory: '/gallery' },
    file,
    auth: { type: 'guest', username: 'guest-user' },
    clientIp: '203.0.113.12',
  });

  assert.equal(result.data.original_name, 'demo.png');
  assert.equal(result.data.width, null);
  assert.equal(result.data.height, null);
  assert.equal(records.warn.length, 1);
  assert.equal(records.warn[0][0].filename, 'demo.png');
});
