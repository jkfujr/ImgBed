import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  resolveFileStorageId,
  rebuildMetadataForFile,
} from '../ImgBed/src/services/files/rebuild-metadata.js';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function makeLogger() {
  const calls = { warn: [], error: [], log: [] };
  return {
    calls,
    warn(...args) { calls.warn.push(args); },
    error(...args) { calls.error.push(args); },
    log(...args) { calls.log.push(args); },
  };
}

function testResolveFileStorageIdPrefersStorageInstanceId() {
  const file = {
    id: 'file-1',
    storage_instance_id: 'local-1',
    storage_channel: 'local',
    storage_meta: null,
    storage_config: JSON.stringify({ instance_id: 'legacy-local' }),
  };

  const resolved = resolveFileStorageId(file);
  assert.equal(resolved, file.storage_instance_id);
  assert.notEqual(resolved, 'legacy-local');
  console.log('  [OK] resolveFileStorageId：优先使用 storage_instance_id');
}

function testResolveFileStorageIdFallsBackToLegacyMeta() {
  const file = {
    id: 'file-legacy',
    storage_instance_id: null,
    storage_meta: null,
    storage_config: JSON.stringify({ instance_id: 'legacy-local' }),
  };

  const resolved = resolveFileStorageId(file);
  assert.equal(resolved, 'legacy-local');
  console.log('  [OK] resolveFileStorageId：兼容读取旧 instance_id');
}

async function testRebuildMetadataForFileUsesGetStreamResponse() {
  const file = {
    id: 'file-2',
    storage_instance_id: 'local-1',
    storage_channel: 'local',
    storage_meta: null,
    storage_key: 'key-2',
  };

  const logger = makeLogger();
  const db = {
    prepare() {
      return {
        run() {},
      };
    },
  };

  const storageManager = {
    getStorage(id) {
      if (id !== 'local-1') {
        return undefined;
      }

      return {
        async getStreamResponse() {
          return {
            stream: Readable.from([Buffer.from('image-content')]),
            contentLength: 'image-content'.length,
            totalSize: 'image-content'.length,
            statusCode: 200,
            acceptRanges: false,
          };
        },
      };
    },
  };

  const result = await rebuildMetadataForFile(file, {
    db,
    storageManager,
    logger,
    wait: async () => {},
    sleepMs: 0,
    extractMetadata: async () => ({ width: 1, height: 1, exif: '{}' }),
  });

  assert.deepEqual(result, { status: 'updated' });
  assert.equal(logger.calls.warn.length, 0);
  console.log('  [OK] rebuildMetadataForFile：统一读取 getStreamResponse().stream');
}

function testUploadRouteWritesCanonicalStorageFields() {
  const source = read('ImgBed/src/routes/upload.js');
  assert.match(source, /storage_key: String\(storageResult\.storageKey \|\| newFileName\),/);
  assert.match(source, /storage_meta: serializeStorageMeta\(\{ deleteToken: storageResult\.deleteToken \}\),/);
  assert.ok(!source.includes('extra_result'));
  assert.ok(!source.includes('storage_config:'));
  console.log('  [OK] upload.js：只写 storage_key 和 storage_meta.deleteToken');
}

function testFilesListRouteSelectsNewColumns() {
  const source = read('ImgBed/src/routes/files.js');
  assert.match(source, /storage_channel, storage_key, storage_meta, storage_instance_id,/);
  assert.ok(!source.includes('storage_channel, storage_key, storage_config,'));
  console.log('  [OK] files.js：列表查询切到 storage_meta 和 storage_instance_id');
}

function testResolveFileStorageUsesCanonicalResolver() {
  const source = read('ImgBed/src/services/view/resolve-file-storage.js');
  assert.match(source, /import \{ resolveStorageInstanceId \} from '\.\.\/files\/storage-artifacts\.js';/);
  assert.match(source, /const instanceId = resolveStorageInstanceId\(fileRecord\);/);
  console.log('  [OK] resolve-file-storage.js：直读链路统一走 resolveStorageInstanceId');
}

function testHandleStreamOnlyUsesRichResult() {
  const source = read('ImgBed/src/services/view/handle-stream.js');
  assert.match(source, /const readResult = await storage\.getStreamResponse\(storageKey, options\)/);
  assert.ok(!source.includes('typeof storage.getStreamResponse'));
  assert.ok(!source.includes('storage.getStream('));
  console.log('  [OK] handle-stream.js：只消费 StorageReadResult');
}

function testChunkManagerStoresCanonicalChunkMeta() {
  const source = read('ImgBed/src/storage/chunk-manager.js');
  assert.match(source, /storage_meta: serializeStorageMeta\(\{ deleteToken: result\.deleteToken \}\),/);
  assert.match(source, /storage\.getChunkStreamResponse\(chunk\.storage_key, \{\}\)/);
  assert.ok(!source.includes('storage_config: JSON.stringify({})'));
  console.log('  [OK] chunk-manager.js：分块元数据和读取协议都已规范化');
}

function testQuotaCacheMaintenanceLivesInLatestSchemaOnly() {
  const schemaSource = read('ImgBed/src/database/schemas/storage-quota-cache.js');
  const migrateSource = read('ImgBed/src/database/migrate.js');

  assert.ok(!schemaSource.includes('CREATE TRIGGER'), 'storage-quota-cache schema should not define triggers');
  assert.ok(!migrateSource.includes('./migrations/'));
  assert.match(migrateSource, /export const SCHEMA_VERSION = 0;/);
  console.log('  [OK] quota cache maintenance：schema 已固化为 v0 最新结构');
}

async function main() {
  console.log('开始执行存储模型结构测试...');
  testResolveFileStorageIdPrefersStorageInstanceId();
  testResolveFileStorageIdFallsBackToLegacyMeta();
  await testRebuildMetadataForFileUsesGetStreamResponse();
  testUploadRouteWritesCanonicalStorageFields();
  testFilesListRouteSelectsNewColumns();
  testResolveFileStorageUsesCanonicalResolver();
  testHandleStreamOnlyUsesRichResult();
  testChunkManagerStoresCanonicalChunkMeta();
  testQuotaCacheMaintenanceLivesInLatestSchemaOnly();
  console.log('存储模型结构测试全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
