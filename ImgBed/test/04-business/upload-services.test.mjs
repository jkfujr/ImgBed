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
const {
  executePlannedBufferWrite,
  resolveStorageWritePlan,
} = await import(resolveProjectModuleUrl('src', 'services', 'upload', 'storage-write.js'));
const { executeUploadWithFailover, uploadToStorage } = await import(resolveProjectModuleUrl('src', 'services', 'upload', 'execute-upload.js'));

function createStorageDouble({
  putResult,
  putImpl,
  putChunkImpl,
  chunkConfig = {
    enabled: false,
    chunkThreshold: Number.MAX_SAFE_INTEGER,
    chunkSize: 1024 * 1024,
    maxChunks: 100,
    mode: 'generic',
  },
  multipart = null,
} = {}) {
  return {
    getChunkConfig() {
      return chunkConfig;
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
    async putChunk(buffer, meta) {
      if (typeof putChunkImpl === 'function') {
        return putChunkImpl(buffer, meta);
      }

      return {
        storageKey: `${meta.fileId}-chunk-${meta.chunkIndex}`,
        size: buffer.length,
        deleteToken: null,
      };
    },
    async initMultipartUpload(args) {
      return multipart.initMultipartUpload(args);
    },
    async uploadPart(buffer, args) {
      return multipart.uploadPart(buffer, args);
    },
    async completeMultipartUpload(args) {
      return multipart.completeMultipartUpload(args);
    },
    async abortMultipartUpload(args) {
      return multipart.abortMultipartUpload(args);
    },
  };
}

function createLimits({
  enableMaxLimit = false,
  maxLimitMB = 20,
  enableSizeLimit = false,
  sizeLimitMB = 20,
  enableChunking = false,
  chunkSizeMB = 5,
  maxChunks = 10,
} = {}) {
  return {
    enableMaxLimit,
    maxLimitMB,
    enableSizeLimit,
    sizeLimitMB,
    enableChunking,
    chunkSizeMB,
    maxChunks,
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

test('resolveStorageWritePlan 会在无需分块时返回 direct 计划', () => {
  const storage = createStorageDouble({});
  const plan = resolveStorageWritePlan({
    storage,
    fileSize: 4,
    storageId: 'storage-direct',
    storageType: 'local',
    storageManager: {
      getEffectiveUploadLimits() {
        return createLimits();
      },
    },
  });

  assert.equal(plan.mode, 'direct');
  assert.equal(plan.storageId, 'storage-direct');
  assert.equal(plan.fileSize, 4);
  assert.equal(plan.storageType, 'local');
  assert.equal(plan.chunkConfig, null);
});

test('resolveStorageWritePlan 会把需要分块的目标统一归一化为 chunked 或 native', () => {
  const storageManager = {
    getEffectiveUploadLimits() {
      return createLimits({
        enableSizeLimit: true,
        sizeLimitMB: 1,
        enableChunking: true,
        chunkSizeMB: 1,
      });
    },
  };

  const genericPlan = resolveStorageWritePlan({
    storage: createStorageDouble({
      chunkConfig: {
        enabled: true,
        chunkThreshold: 1024 * 1024,
        chunkSize: 1024 * 1024,
        maxChunks: 10,
        mode: 'generic',
      },
    }),
    fileSize: 2 * 1024 * 1024,
    storageId: 'storage-generic',
    storageType: 'mock',
    storageManager,
  });
  const nativePlan = resolveStorageWritePlan({
    storage: createStorageDouble({
      chunkConfig: {
        enabled: true,
        chunkThreshold: 1024 * 1024,
        chunkSize: 1024 * 1024,
        maxChunks: 10,
        mode: 'native',
      },
    }),
    fileSize: 2 * 1024 * 1024,
    storageId: 'storage-native',
    storageType: 's3',
    storageManager,
  });

  assert.equal(genericPlan.mode, 'chunked');
  assert.equal(nativePlan.mode, 'native');
  assert.equal(genericPlan.storageType, 'mock');
  assert.equal(nativePlan.storageType, 's3');
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
      return createLimits({
        enableMaxLimit: true,
        maxLimitMB: 1,
      });
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

test('uploadToStorage 在普通分块模式下会执行显式分块写入，并返回 fileId 作为 storageKey', async () => {
  const chunkCalls = [];
  const result = await uploadToStorage({
    storage: createStorageDouble({
      chunkConfig: {
        enabled: true,
        chunkThreshold: 1024 * 1024,
        chunkSize: 1024 * 1024,
        maxChunks: 10,
        mode: 'generic',
      },
      putChunkImpl(buffer, options) {
        chunkCalls.push({
          size: buffer.length,
          options,
        });
        return {
          storageKey: `chunk-${options.chunkIndex}`,
          size: buffer.length,
          deleteToken: null,
        };
      },
    }),
    buffer: Buffer.alloc(2 * 1024 * 1024),
    fileId: 'chunked-file',
    newFileName: 'chunked-file.png',
    originalName: 'chunked-file.png',
    mimeType: 'image/png',
    finalChannelId: 'storage-2',
    storageManager: {
      getEffectiveUploadLimits() {
        return createLimits({
          enableSizeLimit: true,
          sizeLimitMB: 1,
          enableChunking: true,
          chunkSizeMB: 1,
        });
      },
      getStorageMeta() {
        return {
          type: 'mock',
        };
      },
    },
    config: {},
  });

  assert.equal(result.isChunked, 1);
  assert.equal(result.chunkCount, 2);
  assert.equal(result.storageResult.storageKey, 'chunked-file');
  assert.deepEqual(result.chunkRecords.map((item) => item.storage_type), ['mock', 'mock']);
  assert.deepEqual(chunkCalls, [
    {
      size: 1024 * 1024,
      options: {
        fileId: 'chunked-file',
        chunkIndex: 0,
        totalChunks: 2,
        fileName: 'chunked-file.png',
        mimeType: 'image/png',
      },
    },
    {
      size: 1024 * 1024,
      options: {
        fileId: 'chunked-file',
        chunkIndex: 1,
        totalChunks: 2,
        fileName: 'chunked-file.png',
        mimeType: 'image/png',
      },
    },
  ]);
});

test('executePlannedBufferWrite 会按既有计划执行 chunked / native / direct 三类写入', async () => {
  const chunkCalls = [];
  const nativeCalls = [];
  const directCalls = [];
  const storage = createStorageDouble({
    putImpl(buffer, meta) {
      directCalls.push({
        size: buffer.length,
        meta,
      });
      return {
        storageKey: 'direct-plan-key',
        size: buffer.length,
        deleteToken: null,
      };
    },
  });

  const chunkedResult = await executePlannedBufferWrite({
    plan: {
      mode: 'chunked',
      storageId: 'storage-generic',
      storageType: 'mock',
      chunkConfig: {
        chunkSize: 3,
      },
    },
    storage,
    buffer: Buffer.from('abcdef'),
    fileId: 'chunked-file',
    newFileName: 'chunked-file.png',
    originalName: 'chunked-file.png',
    mimeType: 'image/png',
    writeGenericChunksFn: async (options) => {
      chunkCalls.push({
        size: options.buffer.length,
        options,
      });
      return {
        chunkCount: 2,
        chunkRecords: [{ chunk_index: 0 }, { chunk_index: 1 }],
      };
    },
  });
  const nativeResult = await executePlannedBufferWrite({
    plan: {
      mode: 'native',
      storageId: 'storage-native',
      chunkConfig: {
        chunkSize: 3,
      },
    },
    storage,
    buffer: Buffer.from('native'),
    fileId: 'native-file',
    newFileName: 'native-file.png',
    originalName: 'native-file.png',
    mimeType: 'image/png',
    config: {
      performance: {
        s3Multipart: {
          enabled: true,
        },
      },
    },
    writeNativeMultipartObjectFn: async (options) => {
      nativeCalls.push({
        size: options.buffer.length,
        options,
      });
      return {
        storageKey: 'native-plan-key',
        size: options.buffer.length,
        deleteToken: { uploadId: 'u-1' },
      };
    },
  });
  const directResult = await executePlannedBufferWrite({
    plan: {
      mode: 'direct',
      storageId: 'storage-direct',
    },
    storage,
    buffer: Buffer.from('demo'),
    fileId: 'direct-file',
    newFileName: 'direct-file.png',
    originalName: 'direct-file.png',
    mimeType: 'image/png',
  });

  assert.equal(chunkedResult.isChunked, 1);
  assert.equal(chunkedResult.chunkCount, 2);
  assert.equal(chunkedResult.storageResult.storageKey, 'chunked-file');
  assert.equal(nativeResult.isChunked, 0);
  assert.equal(nativeResult.storageResult.storageKey, 'native-plan-key');
  assert.equal(directResult.isChunked, 0);
  assert.equal(directResult.storageResult.storageKey, 'direct-plan-key');
  assert.deepEqual(chunkCalls, [{
    size: 6,
    options: {
      storage,
      buffer: Buffer.from('abcdef'),
      fileId: 'chunked-file',
      fileName: 'chunked-file.png',
      mimeType: 'image/png',
      storageId: 'storage-generic',
      storageType: 'mock',
      chunkConfig: {
        chunkSize: 3,
      },
    },
  }]);
  assert.deepEqual(nativeCalls, [{
    size: 6,
    options: {
      storage,
      buffer: Buffer.from('native'),
      fileName: 'native-file.png',
      mimeType: 'image/png',
      chunkConfig: {
        chunkSize: 3,
      },
      config: {
        performance: {
          s3Multipart: {
            enabled: true,
          },
        },
      },
    },
  }]);
  assert.deepEqual(directCalls, [{
    size: 4,
    meta: {
      id: 'direct-file',
      fileName: 'direct-file.png',
      originalName: 'direct-file.png',
      mimeType: 'image/png',
    },
  }]);
});

test('uploadToStorage 在直传模式下会调用 storage.put 并透传基础元数据', async () => {
  const putCalls = [];
  const storage = createStorageDouble({
    putImpl(buffer, meta) {
      putCalls.push({
        size: buffer.length,
        meta,
      });
      return {
        storageKey: 'direct-key',
        size: buffer.length,
        deleteToken: { key: 'del-1' },
      };
    },
  });

  const result = await uploadToStorage({
    storage,
    buffer: Buffer.from('demo'),
    fileId: 'direct-file',
    newFileName: 'direct-file.png',
    originalName: 'origin-name.png',
    mimeType: 'image/png',
    finalChannelId: 'storage-direct',
    storageManager: {
      getEffectiveUploadLimits() {
        return createLimits();
      },
    },
    config: {},
  });

  assert.equal(result.isChunked, 0);
  assert.equal(result.chunkCount, 0);
  assert.deepEqual(result.chunkRecords, []);
  assert.equal(result.storageResult.storageKey, 'direct-key');
  assert.deepEqual(putCalls, [{
    size: 4,
    meta: {
      id: 'direct-file',
      fileName: 'direct-file.png',
      originalName: 'origin-name.png',
      mimeType: 'image/png',
    },
  }]);
});

test('uploadToStorage 在 S3 原生 multipart 模式下会执行 native multipart 写入', async () => {
  const multipartCalls = [];
  const config = {
    performance: {
      s3Multipart: {
        enabled: true,
        concurrency: 2,
      },
    },
  };

  const result = await uploadToStorage({
    storage: createStorageDouble({
      chunkConfig: {
        enabled: true,
        chunkThreshold: 1024 * 1024,
        chunkSize: 1024 * 1024,
        maxChunks: 10,
        mode: 'native',
      },
      multipart: {
        async initMultipartUpload(args) {
          multipartCalls.push({ step: 'init', args });
          return { uploadId: 'u-1', key: 'multipart-key' };
        },
        async uploadPart(buffer, args) {
          multipartCalls.push({ step: 'part', size: buffer.length, args });
          return {
            partNumber: args.partNumber,
            etag: `etag-${args.partNumber}`,
          };
        },
        async completeMultipartUpload(args) {
          multipartCalls.push({ step: 'complete', args });
          return {
            storageKey: 'multipart-key',
            size: 9,
            deleteToken: { uploadId: 'u-1' },
          };
        },
        async abortMultipartUpload(args) {
          multipartCalls.push({ step: 'abort', args });
        },
      },
    }),
    buffer: Buffer.alloc(2 * 1024 * 1024),
    fileId: 'multipart-file',
    newFileName: 'multipart-file.png',
    originalName: 'multipart-file.png',
    mimeType: 'image/png',
    finalChannelId: 'storage-s3',
    storageManager: {
      getEffectiveUploadLimits() {
        return createLimits({
          enableSizeLimit: true,
          sizeLimitMB: 1,
          enableChunking: true,
          chunkSizeMB: 1,
        });
      },
      getStorageMeta() {
        return {
          type: 's3',
        };
      },
    },
    config,
  });

  assert.equal(result.isChunked, 0);
  assert.equal(result.chunkCount, 0);
  assert.deepEqual(result.chunkRecords, []);
  assert.equal(result.storageResult.storageKey, 'multipart-key');
  assert.deepEqual(multipartCalls, [
    {
      step: 'init',
      args: {
        fileName: 'multipart-file.png',
        mimeType: 'image/png',
      },
    },
    {
      step: 'part',
      size: 1024 * 1024,
      args: {
        uploadId: 'u-1',
        key: 'multipart-key',
        partNumber: 1,
      },
    },
    {
      step: 'part',
      size: 1024 * 1024,
      args: {
        uploadId: 'u-1',
        key: 'multipart-key',
        partNumber: 2,
      },
    },
    {
      step: 'complete',
      args: {
        uploadId: 'u-1',
        key: 'multipart-key',
        parts: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 2, etag: 'etag-2' },
        ],
      },
    },
  ]);
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
      return createLimits();
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

test('executeUploadWithFailover 在渠道实例缺失且无法切换时会返回 500', async () => {
  const storageManager = {
    getStorage() {
      return null;
    },
    getEffectiveUploadLimits() {
      return createLimits();
    },
    selectUploadChannel() {
      return null;
    },
  };

  await assert.rejects(() => executeUploadWithFailover({
    initialChannelId: 'missing',
    buffer: Buffer.from('demo'),
    fileId: 'file-missing',
    newFileName: 'file-missing.png',
    originalName: 'file-missing.png',
    mimeType: 'image/png',
    storageManager,
    config: {
      storage: {
        failoverEnabled: true,
        loadBalanceStrategy: 'default',
      },
    },
  }), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, '找不到可用的存储渠道');
    return true;
  });
});

test('executeUploadWithFailover 在部分 4xx 错误下仍会切换到备选渠道', async () => {
  const primaryStorage = createStorageDouble({
    putImpl() {
      throw createUploadError(404, 'primary missing');
    },
  });
  const backupStorage = createStorageDouble({
    putResult: {
      storageKey: 'backup-4xx',
      size: 4,
      deleteToken: null,
    },
  });

  const storageManager = {
    getStorage(channelId) {
      if (channelId === 'primary') return primaryStorage;
      if (channelId === 'backup') return backupStorage;
      return null;
    },
    getEffectiveUploadLimits() {
      return createLimits();
    },
    selectUploadChannel(_preferredType, excludeIds = []) {
      return excludeIds.includes('primary') ? 'backup' : 'primary';
    },
  };

  const result = await executeUploadWithFailover({
    initialChannelId: 'primary',
    buffer: Buffer.from('demo'),
    fileId: 'file-4xx',
    newFileName: 'file-4xx.png',
    originalName: 'file-4xx.png',
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
  assert.equal(result.storageResult.storageKey, 'backup-4xx');
  assert.deepEqual(result.failedChannels, [{
    id: 'primary',
    error: 'primary missing',
  }]);
});

test('executeUploadWithFailover 在 _sizeLimit 错误下仍可能继续切换到其他渠道', async () => {
  const storageManager = {
    getStorage(channelId) {
      if (channelId === 'primary') {
        return createStorageDouble({});
      }
      if (channelId === 'backup') {
        return createStorageDouble({
          putResult: {
            storageKey: 'backup-size-limit',
            size: 2 * 1024 * 1024,
            deleteToken: null,
          },
        });
      }
      return null;
    },
    getEffectiveUploadLimits(channelId) {
      if (channelId === 'primary') {
        return createLimits({
          enableSizeLimit: true,
          sizeLimitMB: 1,
        });
      }

      return createLimits();
    },
    selectUploadChannel(_preferredType, excludeIds = []) {
      return excludeIds.includes('primary') ? 'backup' : 'primary';
    },
  };

  const result = await executeUploadWithFailover({
    initialChannelId: 'primary',
    buffer: Buffer.alloc(2 * 1024 * 1024),
    fileId: 'file-size-limit',
    newFileName: 'file-size-limit.png',
    originalName: 'file-size-limit.png',
    mimeType: 'image/png',
    storageManager,
    config: {
      storage: {
        failoverEnabled: false,
        loadBalanceStrategy: 'weighted',
      },
    },
  });

  assert.equal(result.finalChannelId, 'backup');
  assert.equal(result.storageResult.storageKey, 'backup-size-limit');
  assert.deepEqual(result.failedChannels, [{
    id: 'primary',
    error: '文件体积超出大小限制 1MB',
  }]);
});

test('executeUploadWithFailover 在没有备选渠道时会返回统一失败错误', async () => {
  const primaryStorage = createStorageDouble({
    putImpl() {
      const error = createUploadError(503, 'primary unavailable');
      error.code = 'ECONNRESET';
      throw error;
    },
  });

  const storageManager = {
    getStorage(channelId) {
      return channelId === 'primary' ? primaryStorage : null;
    },
    getEffectiveUploadLimits() {
      return createLimits();
    },
    selectUploadChannel() {
      return null;
    },
  };

  await assert.rejects(() => executeUploadWithFailover({
    initialChannelId: 'primary',
    buffer: Buffer.from('demo'),
    fileId: 'file-no-backup',
    newFileName: 'file-no-backup.png',
    originalName: 'file-no-backup.png',
    mimeType: 'image/png',
    storageManager,
    config: {
      storage: {
        failoverEnabled: true,
        loadBalanceStrategy: 'default',
      },
    },
  }), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, '所有可用渠道均已尝试，上传失败');
    return true;
  });
});
