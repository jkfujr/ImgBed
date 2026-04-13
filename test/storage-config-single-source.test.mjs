import assert from 'node:assert/strict';

import { sqlite } from '../ImgBed/src/database/index.js';
import { initSchema } from '../ImgBed/src/database/schema.js';
import { readRuntimeConfig, writeRuntimeConfig } from '../ImgBed/src/config/index.js';
import { StorageRegistry } from '../ImgBed/src/storage/runtime/storage-registry.js';

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

initSchema(sqlite);
sqlite.prepare('DELETE FROM storage_channels').run();

const runtimeConfig = readRuntimeConfig();
const baseStorages = Array.isArray(runtimeConfig.storage?.storages)
  ? runtimeConfig.storage.storages
  : [];
const existing = baseStorages.find((item) => item.id === 'local-1') || {
  id: 'local-1',
  type: 'local',
  name: '本地存储',
  enabled: true,
  allowUpload: true,
  config: {
    basePath: './data/storage',
  },
};

writeRuntimeConfig({
  ...runtimeConfig,
  storage: {
    ...(runtimeConfig.storage || {}),
    default: 'local-1',
    storages: [
      {
        ...existing,
        name: '文件配置渠道',
        enabled: true,
        allowUpload: true,
        weight: 1,
        quotaLimitGB: 5,
      },
    ],
  },
});

sqlite.prepare(`
  INSERT INTO storage_channels (
    id, name, type, enabled, allow_upload, weight, quota_limit_gb, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
`).run(
  'local-1',
  '数据库覆盖渠道',
  'local',
  0,
  0,
  99,
  999,
);

const registry = new StorageRegistry({
  db: sqlite,
  logger: createLogger(),
});

await registry.reload();

const meta = registry.getStorageMeta('local-1');
assert.ok(meta, '运行时注册表应只根据配置文件加载启用渠道');
assert.equal(meta.name, '文件配置渠道');
assert.equal(meta.allowUpload, true);
assert.equal(meta.weight, 1);
assert.equal(meta.quotaLimitGB, 5);

const registrySource = await import('../ImgBed/src/storage/runtime/storage-registry.js');
assert.ok(registrySource.StorageRegistry);
