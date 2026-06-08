import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStorageConfig } from '../../src/services/system/apply-storage-config.js';
import { isQuotaThresholdReached } from '../../src/storage/runtime/quota-threshold.js';
import { StorageUploadAutoDisableService } from '../../src/storage/runtime/storage-upload-auto-disable-service.js';

const ONE_GB = 1024 ** 3;

function createHarness({ storages, usedBytesById }) {
  let runtimeConfig = {
    storage: {
      storages: structuredClone(storages),
    },
  };
  normalizeStorageConfig(runtimeConfig);

  const calls = [];
  const service = new StorageUploadAutoDisableService({
    readRuntimeConfig: () => structuredClone(runtimeConfig),
    applyStorageConfigChange: async ({ cfg, storageManager }) => {
      normalizeStorageConfig(cfg);
      runtimeConfig = structuredClone(cfg);
      calls.push('applyStorageConfigChange');
      await storageManager.reload();
    },
    storageManager: {
      async reload() {
        calls.push('storageManager.reload');
      },
    },
    quotaProjectionService: {
      getUsedBytes(storageId) {
        return usedBytesById[storageId] || 0;
      },
    },
    invalidateStorageCaches() {
      calls.push('invalidateStorageCaches');
    },
    logger: {
      warn() {},
      error() {},
    },
  });

  return {
    calls,
    service,
    getRuntimeConfig: () => runtimeConfig,
  };
}

test('isQuotaThresholdReached 会按容量上限与停用阈值判断是否达到停用线', () => {
  assert.equal(isQuotaThresholdReached({ quotaLimitGB: null }, ONE_GB), false);
  assert.equal(isQuotaThresholdReached({ quotaLimitGB: 1, disableThresholdPercent: 95 }, 0.94 * ONE_GB), false);
  assert.equal(isQuotaThresholdReached({ quotaLimitGB: 1, disableThresholdPercent: 95 }, 0.95 * ONE_GB), true);
});

test('StorageUploadAutoDisableService 会持久关闭已达到容量阈值的可上传渠道', async () => {
  const harness = createHarness({
    storages: [
      { id: 'below', enabled: true, allowUpload: true, quotaLimitGB: 1, disableThresholdPercent: 95 },
      { id: 'at-limit', enabled: true, allowUpload: true, quotaLimitGB: 1, disableThresholdPercent: 95 },
      { id: 'over-limit', enabled: true, allowUpload: true, quotaLimitGB: 2, disableThresholdPercent: 50 },
      { id: 'manual-off', enabled: true, allowUpload: false, quotaLimitGB: 1, disableThresholdPercent: 95 },
      { id: 'no-quota', enabled: true, allowUpload: true, quotaLimitGB: null, disableThresholdPercent: 95 },
      { id: 'disabled-channel', enabled: false, allowUpload: true, quotaLimitGB: 1, disableThresholdPercent: 95 },
    ],
    usedBytesById: {
      below: 0.94 * ONE_GB,
      'at-limit': 0.95 * ONE_GB,
      'over-limit': ONE_GB,
      'manual-off': ONE_GB,
      'no-quota': 100 * ONE_GB,
      'disabled-channel': ONE_GB,
    },
  });

  const result = await harness.service.disableExceededUploadChannels();
  const storages = harness.getRuntimeConfig().storage.storages;
  const byId = new Map(storages.map((storage) => [storage.id, storage]));

  assert.deepEqual(result, { disabledIds: ['at-limit', 'over-limit'] });
  assert.equal(byId.get('below').allowUpload, true);
  assert.equal(byId.get('at-limit').allowUpload, false);
  assert.equal(byId.get('over-limit').allowUpload, false);
  assert.equal(byId.get('manual-off').allowUpload, false);
  assert.equal(byId.get('no-quota').allowUpload, true);
  assert.equal(byId.get('disabled-channel').allowUpload, true);
  assert.deepEqual(harness.getRuntimeConfig().storage.allowedUploadChannels, ['below', 'no-quota']);
  assert.deepEqual(harness.calls, [
    'applyStorageConfigChange',
    'storageManager.reload',
    'invalidateStorageCaches',
  ]);
});

test('StorageUploadAutoDisableService 只检查传入的受影响渠道且不会自动恢复上传', async () => {
  const harness = createHarness({
    storages: [
      { id: 'over-limit', enabled: true, allowUpload: true, quotaLimitGB: 1, disableThresholdPercent: 95 },
      { id: 'already-off', enabled: true, allowUpload: false, quotaLimitGB: 1, disableThresholdPercent: 95 },
    ],
    usedBytesById: {
      'over-limit': ONE_GB,
      'already-off': 0,
    },
  });

  assert.deepEqual(await harness.service.disableExceededUploadChannels(['already-off']), {
    disabledIds: [],
  });
  assert.equal(harness.getRuntimeConfig().storage.storages[0].allowUpload, true);
  assert.equal(harness.getRuntimeConfig().storage.storages[1].allowUpload, false);
  assert.deepEqual(harness.calls, []);
});
