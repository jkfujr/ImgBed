import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-upload-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { createUploadError, resolveUploadChannel } = await import(resolveProjectModuleUrl('src', 'services', 'upload', 'resolve-upload.js'));
const { executeUploadWithFailover, uploadToStorage } = await import(resolveProjectModuleUrl('src', 'services', 'upload', 'execute-upload.js'));
const chunkManagerModule = await import(resolveProjectModuleUrl('src', 'storage', 'chunk-manager.js'));
const ChunkManager = chunkManagerModule.default;

function createStorageDouble({ putResult, putImpl } = {}) {
  return {
    getChunkConfig() {
      return {
        enabled: false,
        chunkThreshold: Number.MAX_SAFE_INTEGER,
        chunkSize: 1024 * 1024,
        maxChunks: 100,
      };
    },
    async put(buffer, meta) {
      if (typeof putImpl === 'function') {
        return putImpl(buffer, meta);
      }

      return putResult || {
        storageKey: meta.id,
        size: buffer.length,
        deleteToken: null,
      };
    },
  };
}

test('resolveUploadChannel 会优先走负载均衡选路，并把 preferredType 传给 storageManager', () => {
  const selectCalls = [];
  const storage = createStorageDouble({});
  const storageManager = {
    selectUploadChannel(preferredType) {
      selectCalls.push(preferredType);
      return 'channel-balanced';
    },
    getDefaultStorageId() {
      return 'channel-default';
    },
    getStorage(channelId) {
      return channelId === 'channel-balanced' ? storage : null;
    },
  };

  const result = resolveUploadChannel({
    preferredType: 's3',
  }, storageManager, {
    storage: {
      loadBalanceStrategy: 'weighted',
    },
  });

  assert.equal(result.channelId, 'channel-balanced');
  assert.equal(result.storage, storage);
  assert.deepEqual(selectCalls, ['s3']);
});

test('resolveUploadChannel 在无默认渠道或默认渠道缺失时会抛出 500', () => {
  const noDefaultManager = {
    selectUploadChannel() {
      return null;
    },
    getDefaultStorageId() {
      return null;
    },
    getStorage() {
      return null;
    },
  };

  assert.throws(
    () => resolveUploadChannel({}, noDefaultManager, { storage: { loadBalanceStrategy: 'default' } }),
    /服务端未指定任何默认存储渠道/,
  );

  const missingStorageManager = {
    selectUploadChannel() {
      return null;
    },
    getDefaultStorageId() {
      return 'default-1';
    },
    getStorage() {
      return null;
    },
  };

  assert.throws(
    () => resolveUploadChannel({}, missingStorageManager, { storage: { loadBalanceStrategy: 'default' } }),
    /默认存储渠道不可用或不存在: default-1/,
  );
});

test('uploadToStorage 会在超过最大限制时直接返回 413', async () => {
  const storage = createStorageDouble({});
  const storageManager = {
    getEffectiveUploadLimits() {
      return {
        enableMaxLimit: true,
        maxLimitMB: 1,
        enableSizeLimit: false,
        sizeLimitMB: 10,
        enableChunking: false,
        chunkSizeMB: 5,
        maxChunks: 10,
      };
    },
  };

  await assert.rejects(() => uploadToStorage({
    storage,
    buffer: Buffer.alloc(2 * 1024 * 1024),
    fileId: 'file-1',
    newFileName: 'file-1.png',
    originalName: 'file-1.png',
    mimeType: 'image/png',
    finalChannelId: 'storage-1',
    storageManager,
    config: {},
  }), (error) => {
    assert.equal(error.status, 413);
    assert.match(error.message, /文件体积超出最大限制 1MB/);
    return true;
  });
});

test('uploadToStorage 在普通分块模式下会委托 ChunkManager.uploadChunked，并返回 fileId 作为 storageKey', async (t) => {
  const originalAnalyze = ChunkManager.analyze;
  const originalUploadChunked = ChunkManager.uploadChunked;

  ChunkManager.analyze = () => ({
    needsChunking: true,
    config: {
      mode: 'generic',
    },
  });
  ChunkManager.uploadChunked = async (_storage, buffer, options) => ({
    chunkCount: 2,
    totalSize: buffer.length,
    chunkRecords: [
      {
        file_id: options.fileId,
        chunk_index: 0,
        storage_type: 'mock',
        storage_id: options.storageId,
        storage_key: 'chunk-0',
        storage_meta: null,
        size: 3,
      },
      {
        file_id: options.fileId,
        chunk_index: 1,
        storage_type: 'mock',
        storage_id: options.storageId,
        storage_key: 'chunk-1',
        storage_meta: null,
        size: 3,
      },
    ],
  });

  t.after(() => {
    ChunkManager.analyze = originalAnalyze;
    ChunkManager.uploadChunked = originalUploadChunked;
  });

  const result = await uploadToStorage({
    storage: createStorageDouble({}),
    buffer: Buffer.from('abcdef'),
    fileId: 'chunked-file',
    newFileName: 'chunked-file.png',
    originalName: 'chunked-file.png',
    mimeType: 'image/png',
    finalChannelId: 'storage-2',
    storageManager: {
      getEffectiveUploadLimits() {
        return {
          enableMaxLimit: false,
          maxLimitMB: 10,
          enableSizeLimit: true,
          sizeLimitMB: 1,
          enableChunking: true,
          chunkSizeMB: 1,
          maxChunks: 10,
        };
      },
    },
    config: {},
  });

  assert.equal(result.isChunked, 1);
  assert.equal(result.chunkCount, 2);
  assert.equal(result.storageResult.storageKey, 'chunked-file');
  assert.equal(result.chunkRecords.length, 2);
});

test('executeUploadWithFailover 会在首个渠道失败后切换到备选渠道并保留失败轨迹', async () => {
  const primaryStorage = createStorageDouble({
    putImpl() {
      const error = createUploadError(503, 'primary unavailable');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  });
  const backupStorage = createStorageDouble({
    putResult: {
      storageKey: 'backup-key',
      size: 4,
      deleteToken: { messageId: '8' },
    },
  });

  const selectCalls = [];
  const storageManager = {
    getStorage(channelId) {
      if (channelId === 'primary') return primaryStorage;
      if (channelId === 'backup') return backupStorage;
      return null;
    },
    getEffectiveUploadLimits() {
      return {
        enableMaxLimit: false,
        maxLimitMB: 20,
        enableSizeLimit: false,
        sizeLimitMB: 20,
        enableChunking: false,
        chunkSizeMB: 5,
        maxChunks: 10,
      };
    },
    selectUploadChannel(_preferredType, excludeIds = []) {
      selectCalls.push(excludeIds);
      return excludeIds.includes('primary') ? 'backup' : 'primary';
    },
  };

  const result = await executeUploadWithFailover({
    initialChannelId: 'primary',
    buffer: Buffer.from('demo'),
    fileId: 'file-2',
    newFileName: 'file-2.png',
    originalName: 'file-2.png',
    mimeType: 'image/png',
    storageManager,
    config: {
      storage: {
        failoverEnabled: true,
        loadBalanceStrategy: 'default',
      },
    },
  });

  assert.equal(result.finalChannelId, 'backup');
  assert.equal(result.storageResult.storageKey, 'backup-key');
  assert.deepEqual(result.failedChannels, [
    {
      id: 'primary',
      error: 'primary unavailable',
    },
  ]);
  assert.deepEqual(selectCalls, [['primary']]);
});
