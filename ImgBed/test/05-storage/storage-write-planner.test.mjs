import assert from 'node:assert/strict';
import test from 'node:test';

import { planStorageWrite } from '../../src/storage/write/storage-write-planner.js';

function createStorage({ chunkConfig } = {}) {
  return {
    getChunkConfig() {
      return chunkConfig || {
        enabled: false,
        chunkThreshold: Number.MAX_SAFE_INTEGER,
        chunkSize: 1024 * 1024,
        maxChunks: 100,
        mode: 'generic',
      };
    },
  };
}

function createStorageManager({
  limits,
  storageType = 'mock',
} = {}) {
  return {
    getEffectiveUploadLimits() {
      return limits || {
        enableMaxLimit: false,
        maxLimitMB: 20,
        enableSizeLimit: false,
        sizeLimitMB: 20,
        enableChunking: false,
        chunkSizeMB: 5,
        maxChunks: 10,
      };
    },
    getStorageMeta() {
      return { type: storageType };
    },
  };
}

test('storage-write-planner 会在无需分块时返回 direct 计划', () => {
  const plan = planStorageWrite({
    storage: createStorage(),
    fileSize: 10,
    storageId: 'storage-direct',
    storageManager: createStorageManager(),
  });

  assert.equal(plan.mode, 'direct');
  assert.equal(plan.storageType, 'mock');
  assert.equal(plan.chunkConfig, null);
});

test('storage-write-planner 会根据驱动模式返回 chunked 或 native', () => {
  const storageManager = createStorageManager({
    limits: {
      enableMaxLimit: false,
      maxLimitMB: 20,
      enableSizeLimit: true,
      sizeLimitMB: 1,
      enableChunking: true,
      chunkSizeMB: 1,
      maxChunks: 10,
    },
  });

  const chunkedPlan = planStorageWrite({
    storage: createStorage({
      chunkConfig: {
        enabled: true,
        chunkThreshold: 1024 * 1024,
        chunkSize: 1024 * 1024,
        maxChunks: 10,
        mode: 'generic',
      },
    }),
    fileSize: 2 * 1024 * 1024,
    storageId: 'storage-chunked',
    storageManager,
  });
  const nativePlan = planStorageWrite({
    storage: createStorage({
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
    storageManager,
  });

  assert.equal(chunkedPlan.mode, 'chunked');
  assert.equal(nativePlan.mode, 'native');
});

test('storage-write-planner 会在文件超过限制时返回 413 错误', () => {
  assert.throws(() => planStorageWrite({
    storage: createStorage(),
    fileSize: 2 * 1024 * 1024,
    storageId: 'storage-limit',
    storageManager: createStorageManager({
      limits: {
        enableMaxLimit: true,
        maxLimitMB: 1,
        enableSizeLimit: false,
        sizeLimitMB: 20,
        enableChunking: false,
        chunkSizeMB: 5,
        maxChunks: 10,
      },
    }),
  }), (error) => {
    assert.equal(error.status, 413);
    assert.equal(error._sizeLimit, true);
    return true;
  });
});
