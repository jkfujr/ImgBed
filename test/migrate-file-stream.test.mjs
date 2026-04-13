import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';

import ChunkManager from '../ImgBed/src/storage/chunk-manager.js';
import { migrateFileRecord } from '../ImgBed/src/services/files/migrate-file.js';

function makeNodeReadable(content) {
  return Readable.from([Buffer.from(content)]);
}

function makeDb() {
  return {
    prepare() {
      return {
        run() {},
        all() { return []; },
        get() { return null; },
      };
    },
    transaction(fn) {
      return fn;
    },
  };
}

function createStorageManagerStub({ entries = new Map(), ...overrides } = {}) {
  const storageEntries = entries instanceof Map ? entries : new Map(entries);
  return {
    getStorage(id) {
      return storageEntries.get(id)?.instance || null;
    },
    getStorageMeta(id) {
      return storageEntries.get(id) || null;
    },
    ...overrides,
  };
}

async function drainReadable(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function testChunkManagerUsesGetChunkStreamResponse() {
  const calls = [];
  const chunks = [
    { chunk_index: 0, storage_id: 'storage-1', storage_key: 'chunk-0', size: 3 },
    { chunk_index: 1, storage_id: 'storage-1', storage_key: 'chunk-1', size: 3 },
  ];

  const stream = ChunkManager.createChunkedReadStream(chunks, () => ({
    async getChunkStreamResponse(storageKey) {
      calls.push(storageKey);
      return {
        stream: makeNodeReadable(storageKey === 'chunk-0' ? 'abc' : 'def'),
        contentLength: 3,
        totalSize: 3,
        statusCode: 200,
        acceptRanges: false,
      };
    },
  }), { totalSize: 6 });

  const body = await drainReadable(stream);
  assert.deepEqual(calls, ['chunk-0', 'chunk-1']);
  assert.equal(body.toString(), 'abcdef');
  console.log('  [OK] ChunkManager.createChunkedReadStream：统一走 getChunkStreamResponse().stream');
}

async function testMigrateNonChunkedReadsThroughGetStreamResponse() {
  let sourceReadCalled = 0;
  let receivedReadable = null;

  const storageManager = createStorageManagerStub({
    entries: new Map([
      ['src', {
        type: 'local',
        instance: {
          async getStreamResponse() {
            sourceReadCalled++;
            return {
              stream: makeNodeReadable('stream-passthrough-content'),
              contentLength: 26,
              totalSize: 26,
              statusCode: 200,
              acceptRanges: false,
            };
          },
          async delete() {
            return true;
          },
        },
      }],
      ['dst', {
        type: 'local',
        instance: {
          async put(file, options) {
            receivedReadable = file;
            return {
              storageKey: options.fileName,
              size: options.contentLength,
              deleteToken: null,
              raw: null,
            };
          },
          getChunkConfig() {
            return { enabled: false, chunkThreshold: Infinity, chunkSize: 0, maxChunks: 0, mode: 'generic' };
          },
        },
      }],
    ]),
    isUploadAllowed: () => true,
    getEffectiveUploadLimits: () => ({
      enableSizeLimit: false,
      enableChunking: false,
      enableMaxLimit: false,
    }),
    applyPendingQuotaEvents: async () => {},
  });

  const result = await migrateFileRecord({
    id: 'file-004',
    storage_instance_id: 'src',
    storage_key: 'src/file-004',
    storage_meta: null,
    is_chunked: 0,
    size: 26,
    file_name: 'file-004.txt',
    original_name: 'test.txt',
    mime_type: 'text/plain',
  }, {
    targetChannel: 'dst',
    targetEntry: storageManager.getStorageMeta('dst'),
    db: makeDb(),
    storageManager,
  });

  assert.equal(result.status, 'success');
  assert.equal(sourceReadCalled, 1);
  assert.ok(receivedReadable instanceof Readable);
  console.log('  [OK] migrateFileRecord：非分块读取统一走 getStreamResponse');
}

async function testMigrateChunkedUsesPutChunkAndCanonicalChunkRecords() {
  const capturedChunkRecords = [];
  let putCalled = 0;
  let putChunkCalled = 0;

  const sourceStorage = {
    async getStreamResponse() {
      return {
        stream: makeNodeReadable('chunked-file-data'),
        contentLength: 17,
        totalSize: 17,
        statusCode: 200,
        acceptRanges: false,
      };
    },
    async delete() {
      return true;
    },
  };

  const targetStorage = {
    getChunkConfig() {
      return {
        enabled: true,
        chunkThreshold: 10,
        chunkSize: 8,
        maxChunks: 100,
        mode: 'generic',
      };
    },
    async put() {
      putCalled++;
      return { storageKey: 'unexpected', size: 0, deleteToken: null, raw: null };
    },
    async putChunk(buf, options) {
      putChunkCalled++;
      return {
        storageKey: `chunk-${options.chunkIndex}`,
        size: buf.length,
        deleteToken: { messageId: options.chunkIndex + 1, chatId: '-1' },
        raw: null,
      };
    },
    async deleteChunk() {
      return true;
    },
  };

  const originalInsertChunks = ChunkManager.insertChunks;
  ChunkManager.insertChunks = (records) => {
    capturedChunkRecords.push(...records);
  };

  try {
    const storageManager = createStorageManagerStub({
      entries: new Map([
        ['src', { type: 'local', instance: sourceStorage }],
        ['dst', { type: 'telegram', instance: targetStorage }],
      ]),
      isUploadAllowed: () => true,
      getEffectiveUploadLimits: () => ({
        enableSizeLimit: false,
        enableChunking: false,
        enableMaxLimit: false,
      }),
      applyPendingQuotaEvents: async () => {},
    });

    const result = await migrateFileRecord({
      id: 'file-005',
      storage_instance_id: 'src',
      storage_key: 'src/file-005',
      storage_meta: null,
      is_chunked: 0,
      size: 17,
      file_name: 'file-005.txt',
      original_name: 'test.txt',
      mime_type: 'text/plain',
    }, {
      targetChannel: 'dst',
      targetEntry: storageManager.getStorageMeta('dst'),
      db: makeDb(),
      storageManager,
    });

    assert.equal(result.status, 'success');
    assert.equal(putCalled, 0, 'generic 分块路径不应调用 put');
    assert.ok(putChunkCalled > 0, 'generic 分块路径必须调用 putChunk');
    assert.ok(capturedChunkRecords.every((record) => record.storage_meta && record.storage_meta.includes('deleteToken')));
    console.log('  [OK] migrateFileRecord：分块迁移写入 canonical chunk storage_meta');
  } finally {
    ChunkManager.insertChunks = originalInsertChunks;
  }
}

async function run() {
  console.log('\n== migrate-file stream canonical tests ==');
  await testChunkManagerUsesGetChunkStreamResponse();
  await testMigrateNonChunkedReadsThroughGetStreamResponse();
  await testMigrateChunkedUsesPutChunkAndCanonicalChunkRecords();
  console.log('\nmigrate-file-stream tests passed\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
