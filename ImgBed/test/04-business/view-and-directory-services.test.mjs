import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Writable, Readable } from 'node:stream';
import test from 'node:test';

import { createStorageReadResult } from '../../src/storage/contract.js';
import { insertDirectory } from '../../src/database/directories-dao.js';
import { insertFile, getFileById } from '../../src/database/files-dao.js';
import { createTestDb } from '../helpers/storage-test-helpers.mjs';
import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-04-view-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { resolveFileStorage, parseRangeHeader, buildStreamHeaders } = await import(resolveProjectModuleUrl('src', 'services', 'view', 'resolve-file-storage.js'));
const handleStreamModule = await import(resolveProjectModuleUrl('src', 'services', 'view', 'handle-stream.js'));
const { handleChunkedStream, handleRegularStream } = handleStreamModule;
const chunkManagerModule = await import(resolveProjectModuleUrl('src', 'storage', 'chunk-manager.js'));
const ChunkManager = chunkManagerModule.default;
const {
  buildPath,
  renameDirectory,
  resolveParentPath,
} = await import(resolveProjectModuleUrl('src', 'services', 'directories', 'directory-operations.js'));

function buildFileRecord(overrides = {}) {
  return {
    id: overrides.id || 'file-1',
    file_name: overrides.file_name || 'demo.png',
    original_name: overrides.original_name || 'origin-demo.png',
    mime_type: overrides.mime_type || 'image/png',
    size: overrides.size ?? 6,
    storage_channel: overrides.storage_channel || 'local',
    storage_key: overrides.storage_key || 'storage-key',
    storage_meta: overrides.storage_meta ?? null,
    storage_instance_id: overrides.storage_instance_id || 'storage-1',
    upload_ip: overrides.upload_ip || '127.0.0.1',
    upload_address: overrides.upload_address || '{}',
    uploader_type: overrides.uploader_type || 'admin',
    uploader_id: overrides.uploader_id || 'admin',
    directory: overrides.directory || '/',
    tags: overrides.tags ?? null,
    is_public: overrides.is_public ?? 1,
    is_chunked: overrides.is_chunked ?? 0,
    chunk_count: overrides.chunk_count ?? 0,
    width: overrides.width === undefined ? null : overrides.width,
    height: overrides.height === undefined ? null : overrides.height,
    exif: overrides.exif ?? null,
    status: overrides.status || 'active',
  };
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
    this.bodyChunks = [];
  }

  _write(chunk, _encoding, callback) {
    this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  setHeader(key, value) {
    this.headers[String(key).toLowerCase()] = String(value);
  }

  getHeader(key) {
    return this.headers[String(key).toLowerCase()];
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  json(payload) {
    this.setHeader('content-type', 'application/json');
    this.end(Buffer.from(JSON.stringify(payload)));
    return this;
  }

  get body() {
    return Buffer.concat(this.bodyChunks).toString('utf8');
  }
}

test('resolveFileStorage 会返回 storage 与 storageKey，缺失映射时抛出 500', () => {
  const storage = { id: 'storage-1' };
  const storageManager = {
    getStorage(storageId) {
      return storageId === 'storage-1' ? storage : null;
    },
  };

  const result = resolveFileStorage({
    storage_instance_id: 'storage-1',
    storage_key: 'file-key',
    storage_channel: 'local',
  }, { storageManager });

  assert.deepEqual(result, {
    storage,
    storageKey: 'file-key',
  });

  assert.throws(
    () => resolveFileStorage({
      storage_instance_id: 'missing',
      storage_key: 'file-key',
      storage_channel: 'local',
    }, { storageManager }),
    /图床渠道调度失败/,
  );
});

test('parseRangeHeader 和 buildStreamHeaders 会生成当前访问链需要的部分内容头', () => {
  const range = parseRangeHeader('bytes=2-4', 10);
  assert.deepEqual(range, {
    start: 2,
    end: 4,
    isPartial: true,
  });

  const headers = buildStreamHeaders({
    fileRecord: {
      mime_type: 'image/png',
      original_name: 'demo.png',
    },
    start: 2,
    end: 4,
    isPartial: true,
    totalSize: 10,
    etag: '"etag-demo"',
    lastModified: '2024-01-01T00:00:00.000Z',
  });

  assert.equal(headers.get('content-type'), 'image/png');
  assert.equal(headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(headers.get('content-length'), '3');
  assert.equal(headers.get('etag'), '"etag-demo"');
});

test('handleRegularStream 在上游返回完整 200 响应时会降级为完整响应输出', async () => {
  const res = new MockResponse();
  const storage = {
    async getStreamResponse(storageKey, options) {
      assert.equal(storageKey, 'file-key');
      assert.deepEqual(options, { start: 1, end: 2 });
      return createStorageReadResult({
        stream: Readable.from([Buffer.from('abcdef')]),
        contentLength: 6,
        totalSize: 6,
        statusCode: 200,
        acceptRanges: true,
      });
    },
  };

  await handleRegularStream({
    id: 'file-1',
    mime_type: 'image/png',
    original_name: 'demo.png',
    size: 6,
  }, res, storage, 'file-key', {
    start: 1,
    end: 2,
    isPartial: true,
    etag: '"etag-demo"',
    lastModified: '2024-01-01T00:00:00.000Z',
  });

  await once(res, 'finish');

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-range'), undefined);
  assert.equal(res.getHeader('content-length'), '6');
  assert.equal(res.body, 'abcdef');
});

test('handleChunkedStream 在分块记录缺失时会抛出 500', async (t) => {
  const originalGetChunks = ChunkManager.getChunks;
  ChunkManager.getChunks = async () => [];

  t.after(() => {
    ChunkManager.getChunks = originalGetChunks;
  });

  await assert.rejects(() => handleChunkedStream({
    id: 'file-chunked',
    size: 10,
  }, new MockResponse(), {
    start: 0,
    end: 9,
    isPartial: false,
    storageManager: {
      getStorage() {
        return null;
      },
    },
    etag: '"etag"',
    lastModified: '2024-01-01T00:00:00.000Z',
  }), (error) => {
    assert.equal(error.status, 500);
    assert.match(error.message, /分块记录缺失/);
    return true;
  });
});

test('renameDirectory 会级联更新子目录与已归属文件路径', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  const rootDir = insertDirectory(db, {
    name: '图库',
    path: '/gallery',
    parentId: null,
  });
  const childDir = insertDirectory(db, {
    name: '旅行',
    path: '/gallery/travel',
    parentId: rootDir.lastInsertRowid,
  });

  insertFile(db, buildFileRecord({
    id: 'file-root',
    directory: '/gallery',
  }));
  insertFile(db, buildFileRecord({
    id: 'file-child',
    directory: '/gallery/travel',
  }));

  const result = await renameDirectory(Number(rootDir.lastInsertRowid), 'albums', db);

  assert.deepEqual(result, {
    id: Number(rootDir.lastInsertRowid),
    name: 'albums',
    path: '/albums',
  });
  assert.equal(db.prepare('SELECT path FROM directories WHERE id = ?').get(Number(childDir.lastInsertRowid)).path, '/albums/travel');
  assert.equal(getFileById(db, 'file-root').directory, '/albums');
  assert.equal(getFileById(db, 'file-child').directory, '/albums/travel');
});

test('buildPath 会清理非法分隔符，resolveParentPath 在父目录缺失时返回 404', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  assert.equal(buildPath('/gallery', ' 2024/travel\\cover '), '/gallery/2024travelcover');

  await assert.rejects(() => resolveParentPath(999, db), (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.message, '指定的父级目录不存在');
    return true;
  });
});
