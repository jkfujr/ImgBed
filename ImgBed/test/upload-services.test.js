const assert = require('node:assert/strict');
const { resolveUploadChannel } = require('../src/services/upload/resolve-upload');
const { checkUploadQuota } = require('../src/services/upload/check-upload-quota');
const { executeUploadWithFailover } = require('../src/services/upload/execute-upload');

function createStorageManager(overrides = {}) {
  const storages = new Map();
  if (overrides.storages) {
    for (const [id, storage] of Object.entries(overrides.storages)) {
      storages.set(id, storage);
    }
  }

  return {
    instances: new Map((overrides.instances || []).map((entry) => [entry.id, entry])),
    getStorage: overrides.getStorage || ((id) => storages.get(id) || null),
    selectUploadChannel: overrides.selectUploadChannel || (() => null),
    getDefaultStorageId: overrides.getDefaultStorageId || (() => null),
    isUploadAllowed: overrides.isUploadAllowed || (() => true),
    isQuotaExceeded: overrides.isQuotaExceeded || (() => false),
    getEffectiveUploadLimits: overrides.getEffectiveUploadLimits || (() => ({
      enableMaxLimit: false,
      enableSizeLimit: false,
      enableChunking: false,
      sizeLimitMB: 10,
      chunkSizeMB: 5,
      maxChunks: 0,
      maxLimitMB: 100,
    })),
  };
}

async function testResolveUploadChannelUsesExplicitChannel() {
  const storage = { name: 's3 storage' };
  const manager = createStorageManager({
    storages: { 's3-1': storage },
    getDefaultStorageId: () => 'local-1',
  });

  const result = resolveUploadChannel({ channel: 's3-1' }, manager, { storage: { loadBalanceStrategy: 'default' } });
  assert.equal(result.channelId, 's3-1');
  assert.equal(result.storage, storage);
}

async function testResolveUploadChannelRejectsMissingExplicitChannel() {
  const manager = createStorageManager({
    storages: { 'local-1': { name: 'local storage' } },
    getDefaultStorageId: () => 'local-1',
  });

  assert.throws(
    () => resolveUploadChannel({ channel: 'missing-channel' }, manager, { storage: { loadBalanceStrategy: 'default' } }),
    /找不到指定的存储渠道: missing-channel/
  );
}

async function testResolveUploadChannel() {
  const storage = { name: 'storage' };
  const manager = createStorageManager({
    storages: { 'local-1': storage },
    getDefaultStorageId: () => 'local-1',
  });

  const result = resolveUploadChannel({}, manager, { storage: { loadBalanceStrategy: 'default' } });
  assert.equal(result.channelId, 'local-1');
  assert.equal(result.storage, storage);
}

async function testResolveUploadChannelThrowsWhenMissing() {
  const manager = createStorageManager({
    getDefaultStorageId: () => null,
  });

  assert.throws(() => resolveUploadChannel({}, manager, { storage: { loadBalanceStrategy: 'default' } }), /服务端未指定任何默认存储渠道/);
}

async function testCheckUploadQuotaAutoMode() {
  const manager = createStorageManager({
    isUploadAllowed: (id) => id === 'local-1',
  });

  const allowed = await checkUploadQuota({
    channelId: 'local-1',
    storageManager: manager,
    db: {},
    config: { upload: { quotaCheckMode: 'auto' } },
  });

  assert.equal(allowed, true);
}

async function testCheckUploadQuotaAlwaysMode() {
  const db = {
    selectFrom() {
      return {
        select() {
          return {
            async execute() {
              return [
                { size: 10, storage_config: JSON.stringify({ instance_id: 'local-1' }) },
                { size: 5, storage_config: JSON.stringify({ instance_id: 'local-2' }) },
              ];
            },
          };
        },
      };
    },
  };

  let measuredBytes = 0;
  const manager = createStorageManager({
    isQuotaExceeded: (id, totalBytes) => {
      assert.equal(id, 'local-1');
      measuredBytes = totalBytes;
      return false;
    },
  });

  const allowed = await checkUploadQuota({
    channelId: 'local-1',
    storageManager: manager,
    db,
    config: { upload: { quotaCheckMode: 'always' } },
  });

  assert.equal(allowed, true);
  assert.equal(measuredBytes, 10);
}

async function testExecuteUploadWithFailoverSwitchesChannel() {
  const primaryStorage = {
    async put() {
      throw new Error('network down');
    },
    getChunkConfig() {
      return { enabled: false, chunkThreshold: 1024, chunkSize: 1024, maxChunks: 10 };
    },
  };
  const backupStorage = {
    async put(buffer, payload) {
      assert.equal(buffer.length, 4);
      assert.equal(payload.id, 'file-id');
      return { id: 'stored-id' };
    },
    getChunkConfig() {
      return { enabled: false, chunkThreshold: 1024, chunkSize: 1024, maxChunks: 10 };
    },
  };

  const manager = createStorageManager({
    storages: {
      primary: primaryStorage,
      backup: backupStorage,
    },
    selectUploadChannel: (_preferredType, excludeIds) => {
      if (excludeIds.includes('primary')) return 'backup';
      return 'primary';
    },
    getEffectiveUploadLimits: () => ({
      enableMaxLimit: false,
      enableSizeLimit: false,
      enableChunking: false,
      sizeLimitMB: 10,
      chunkSizeMB: 5,
      maxChunks: 0,
      maxLimitMB: 100,
    }),
  });

  const result = await executeUploadWithFailover({
    initialChannelId: 'primary',
    buffer: Buffer.from('test'),
    fileId: 'file-id',
    newFileName: 'file-id.png',
    originalName: 'origin.png',
    mimeType: 'image/png',
    storageManager: manager,
    config: { storage: { failoverEnabled: true, loadBalanceStrategy: 'default' } },
  });

  assert.equal(result.finalChannelId, 'backup');
  assert.equal(result.storageResult.id, 'stored-id');
  assert.equal(result.failedChannels.length, 1);
  assert.equal(result.failedChannels[0].id, 'primary');
}

async function main() {
  await testResolveUploadChannelUsesExplicitChannel();
  await testResolveUploadChannelRejectsMissingExplicitChannel();
  await testResolveUploadChannel();
  await testResolveUploadChannelThrowsWhenMissing();
  await testCheckUploadQuotaAutoMode();
  await testCheckUploadQuotaAlwaysMode();
  await testExecuteUploadWithFailoverSwitchesChannel();
  console.log('upload service tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
