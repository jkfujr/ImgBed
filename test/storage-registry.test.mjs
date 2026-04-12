import { strict as assert } from 'node:assert';
import fs from 'node:fs';

import { getSystemConfigPath } from '../ImgBed/src/services/system/config-io.js';
import { StorageRegistry } from '../ImgBed/src/storage/runtime/storage-registry.js';

const configPath = getSystemConfigPath();

function makeLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function makeDb(rows, { throwOnPrepare = false } = {}) {
  return {
    prepare(sql) {
      assert.match(sql, /SELECT \* FROM storage_channels/);
      if (throwOnPrepare) {
        throw new Error('db unavailable');
      }
      return {
        all() {
          return rows;
        },
      };
    },
  };
}

class TestStorageRegistry extends StorageRegistry {
  async createStorageInstance(type, instanceConfig) {
    if (instanceConfig?.failInit) {
      throw new Error(`init failed: ${type}`);
    }

    return {
      type,
      instanceConfig,
      async testConnection() {
        return { ok: true, type, instanceConfig };
      },
    };
  }
}

async function withConfig(config, fn) {
  const original = fs.readFileSync(configPath, 'utf8');
  try {
    if (typeof config === 'string') {
      fs.writeFileSync(configPath, config, 'utf8');
    } else {
      writeConfig(config);
    }
    await fn();
  } finally {
    fs.writeFileSync(configPath, original, 'utf8');
  }
}

async function testReloadMergesFileConfigAndDbMetadata() {
  await withConfig({
    storage: {
      default: 'local-1',
      allowedUploadChannels: ['local-1', 's3-1'],
      storages: [
        {
          id: 'local-1',
          name: 'Local File',
          type: 'local',
          enabled: true,
          allowUpload: false,
          weight: 1,
          quotaLimitGB: 1,
          disableThresholdPercent: 80,
          enableSizeLimit: true,
          sizeLimitMB: 12,
          enableChunking: true,
          chunkSizeMB: 3,
          maxChunks: 4,
          enableMaxLimit: true,
          maxLimitMB: 24,
          config: { root: '/tmp/local-1' },
        },
        {
          id: 's3-1',
          name: 'S3 File',
          type: 's3',
          enabled: true,
          allowUpload: true,
          weight: 2,
          config: { bucket: 'files' },
        },
      ],
    },
    upload: {
      fullCheckIntervalHours: 9,
    },
  }, async () => {
    const registry = new TestStorageRegistry({
      db: makeDb([
        {
          id: 'local-1',
          name: 'Local DB',
          enabled: 1,
          allow_upload: 1,
          weight: 5,
          quota_limit_gb: 8,
        },
        {
          id: 's3-1',
          name: 'S3 DB',
          enabled: 0,
          allow_upload: 1,
          weight: 99,
          quota_limit_gb: 20,
        },
      ]),
      logger: makeLogger(),
    });

    await registry.reload();

    assert.equal(registry.getDefaultStorageId(), 'local-1');
    assert.equal(registry.getUploadConfig().fullCheckIntervalHours, 9);
    assert.deepEqual(registry.listEnabledStorages(), [
      { id: 'local-1', type: 'local', allowUpload: true },
    ]);

    const localMeta = registry.getStorageMeta('local-1');
    assert.equal(localMeta.name, 'Local DB');
    assert.equal(localMeta.allowUpload, true);
    assert.equal(localMeta.weight, 5);
    assert.equal(localMeta.quotaLimitGB, 8);
    assert.equal(localMeta.enableSizeLimit, true);
    assert.equal(localMeta.chunkSizeMB, 3);

    const localStorage = registry.getStorage('local-1');
    assert.equal(localStorage.type, 'local');
    assert.deepEqual(localStorage.instanceConfig, { root: '/tmp/local-1' });
    assert.equal(registry.getStorage('s3-1'), null);
  });

  console.log('  [OK] storage-registry: reload merges file config with DB metadata and filters disabled channels');
}

async function testReloadKeepsPreviousSnapshotOnTopLevelFailure() {
  const registry = new TestStorageRegistry({
    db: makeDb([]),
    logger: makeLogger(),
  });

  registry.config = { default: 'keep' };
  registry.uploadConfig = { fullCheckIntervalHours: 6 };
  registry.instances = new Map([
    ['keep', { type: 'local', allowUpload: true, instance: { stable: true } }],
  ]);

  await withConfig('{ invalid json', async () => {
    await registry.reload();
  });

  assert.equal(registry.getDefaultStorageId(), 'keep');
  assert.deepEqual(registry.getStorageMeta('keep'), {
    type: 'local',
    allowUpload: true,
    instance: { stable: true },
  });
  assert.equal(registry.getUploadConfig().fullCheckIntervalHours, 6);
  console.log('  [OK] storage-registry: top-level reload failure preserves previous registry snapshot');
}

async function testTestConnectionDelegatesToStorageFactory() {
  const registry = new TestStorageRegistry({
    db: makeDb([]),
    logger: makeLogger(),
  });

  const ok = await registry.testConnection('local', { root: '/tmp/test' });
  assert.deepEqual(ok, {
    ok: true,
    type: 'local',
    instanceConfig: { root: '/tmp/test' },
  });

  class FailingRegistry extends StorageRegistry {
    async createStorageInstance() {
      throw new Error('factory boom');
    }
  }

  const failingRegistry = new FailingRegistry({
    db: makeDb([]),
    logger: makeLogger(),
  });

  const failed = await failingRegistry.testConnection('local', {});
  assert.deepEqual(failed, { ok: false, message: 'factory boom' });
  console.log('  [OK] storage-registry: testConnection uses factory result and surfaces errors');
}

async function main() {
  console.log('running storage-registry tests...');
  await testReloadMergesFileConfigAndDbMetadata();
  await testReloadKeepsPreviousSnapshotOnTopLevelFailure();
  await testTestConnectionDelegatesToStorageFactory();
  console.log('storage-registry tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
