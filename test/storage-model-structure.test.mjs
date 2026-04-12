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
    storage_config: '{}',
  };

  const resolved = resolveFileStorageId(file);
  assert.equal(resolved, file.storage_instance_id);
  assert.notEqual(resolved, file.storage_channel);
  console.log('  [OK] resolveFileStorageId: 优先使用 storage_instance_id');
}

async function testRebuildMetadataForFileUsesStorageInstanceId() {
  const file = {
    id: 'file-2',
    storage_instance_id: 'local-1',
    storage_channel: 'local',
    storage_config: '{}',
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
        async getStream() {
          return Readable.from([Buffer.from('image-content')]);
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
  console.log('  [OK] rebuildMetadataForFile: 使用 storage_instance_id 定位正确存储');
}

function testUploadRecordUsesFacadeInsteadOfInstancesMap() {
  const source = read('ImgBed/src/routes/upload.js');
  assert.match(source, /const storageMeta = storageManager\.getStorageMeta\(finalChannelId\);/);
  assert.match(source, /storage_channel: String\(storageMeta\?\.type \|\| 'unknown'\),/);
  assert.ok(!source.includes('storageManager.instances.get(finalChannelId)'));
  assert.match(source, /storage_instance_id: String\(finalChannelId\),/);
  console.log('  [OK] upload.js: 通过 facade 获取 storage meta');
}

function testResolveFileStoragePrefersStorageInstanceId() {
  const source = read('ImgBed/src/services/view/resolve-file-storage.js');
  assert.match(source, /const instanceId = fileRecord\.storage_instance_id;/);
  assert.match(source, /const storage = storageManager\.getStorage\(instanceId\);/);
  console.log('  [OK] resolve-file-storage.js: 直读链路优先使用 storage_instance_id');
}

function testFilesSchemaKeepsBothStorageColumns() {
  const source = read('ImgBed/src/database/schemas/files.js');
  assert.match(source, /storage_channel TEXT NOT NULL,/);
  assert.match(source, /storage_instance_id TEXT,/);
  console.log('  [OK] files schema: 保留 storage_channel 和 storage_instance_id');
}

function testStorageManagerDelegatesRuntimeState() {
  const source = read('ImgBed/src/storage/manager.js');
  assert.match(source, /import \{ QuotaProjectionService \} from '\.\/quota\/quota-projection-service\.js';/);
  assert.match(source, /import \{ StorageRegistry \} from '\.\/runtime\/storage-registry\.js';/);
  assert.match(source, /import \{ UploadSelector \} from '\.\/runtime\/upload-selector\.js';/);
  assert.ok(!source.includes('this.instances = new Map()'));
  assert.ok(!source.includes('this.roundRobinIndex = 0'));
  assert.ok(!source.includes('this.config = config.storage || {}'));
  assert.ok(!source.includes('this.uploadConfig = config.upload || {}'));
  assert.ok(!source.includes('this.quotaProjection = new Map()'));
  assert.ok(!source.includes('this.usageStats = new Map()'));
  assert.ok(!source.includes('_selectRoundRobin('));
  console.log('  [OK] manager.js: runtime state now delegates to registry, selector, and quota service');
}

function runStaticChecks() {
  testUploadRecordUsesFacadeInsteadOfInstancesMap();
  testResolveFileStoragePrefersStorageInstanceId();
  testFilesSchemaKeepsBothStorageColumns();
  testStorageManagerDelegatesRuntimeState();
}

async function main() {
  console.log('开始执行存储模型结构测试...');
  testResolveFileStorageIdPrefersStorageInstanceId();
  await testRebuildMetadataForFileUsesStorageInstanceId();
  runStaticChecks();
  console.log('存储模型结构测试全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
