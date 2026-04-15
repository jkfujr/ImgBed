import assert from 'node:assert/strict';
import test from 'node:test';

import { writeGenericChunks } from '../../src/storage/write/generic-chunk-writer.js';

test('generic-chunk-writer 会按显式 storageType 生成分块记录', async () => {
  const calls = [];
  const result = await writeGenericChunks({
    storage: {
      getChunkConfig() {
        return {
          chunkSize: 3,
        };
      },
      async putChunk(buffer, options) {
        calls.push({
          size: buffer.length,
          options,
        });
        return {
          storageKey: `chunk-${options.chunkIndex}`,
          size: buffer.length,
          deleteToken: null,
        };
      },
      async deleteChunk() {
        return true;
      },
    },
    buffer: Buffer.from('abcdef'),
    fileId: 'file-1',
    fileName: 'file-1.png',
    mimeType: 'image/png',
    storageId: 'storage-1',
    storageType: 'mock',
    chunkConfig: {
      chunkSize: 3,
    },
  });

  assert.equal(result.chunkCount, 2);
  assert.deepEqual(result.chunkRecords.map((item) => item.storage_type), ['mock', 'mock']);
  assert.deepEqual(calls.map((item) => item.options.chunkIndex), [0, 1]);
});

test('generic-chunk-writer 会把 storageType 透传给批量驱动优化路径', async () => {
  const batchCalls = [];
  const result = await writeGenericChunks({
    storage: {
      async uploadChunkedBatch(buffer, options) {
        batchCalls.push({
          size: buffer.length,
          options,
        });
        return {
          chunkCount: 1,
          totalSize: buffer.length,
          chunkRecords: [],
        };
      },
    },
    buffer: Buffer.from('abc'),
    fileId: 'file-2',
    fileName: 'file-2.png',
    mimeType: 'image/png',
    storageId: 'storage-2',
    storageType: 'huggingface',
  });

  assert.equal(result.chunkCount, 1);
  assert.deepEqual(batchCalls, [{
    size: 3,
    options: {
      fileId: 'file-2',
      fileName: 'file-2.png',
      mimeType: 'image/png',
      storageId: 'storage-2',
      storageType: 'huggingface',
    },
  }]);
});

test('generic-chunk-writer 会在中途失败时清理已上传分块', async () => {
  const deleted = [];

  await assert.rejects(() => writeGenericChunks({
    storage: {
      getChunkConfig() {
        return {
          chunkSize: 3,
        };
      },
      async putChunk(buffer, options) {
        if (options.chunkIndex === 1) {
          throw new Error('chunk failed');
        }

        return {
          storageKey: `chunk-${options.chunkIndex}`,
          size: buffer.length,
          deleteToken: null,
        };
      },
      async deleteChunk(storageKey) {
        deleted.push(storageKey);
        return true;
      },
    },
    buffer: Buffer.from('abcdef'),
    fileId: 'file-3',
    fileName: 'file-3.png',
    mimeType: 'image/png',
    storageId: 'storage-3',
    storageType: 'mock',
    chunkConfig: {
      chunkSize: 3,
    },
  }), /chunk failed/);

  assert.deepEqual(deleted, ['chunk-0']);
});
