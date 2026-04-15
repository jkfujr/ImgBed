import assert from 'node:assert/strict';
import test from 'node:test';

import { StoragePolicyService } from '../../src/storage/runtime/storage-policy-service.js';
import { StorageRuntime } from '../../src/storage/runtime/storage-runtime.js';

test('StoragePolicyService 会按阈值与白名单判断上传准入', () => {
  const registry = {
    getStorageMeta(storageId) {
      if (storageId !== 'storage-1') {
        return null;
      }

      return {
        allowUpload: true,
        quotaLimitGB: 1,
        disableThresholdPercent: 50,
      };
    },
    getConfig() {
      return {
        allowedUploadChannels: ['storage-1'],
      };
    },
    getUploadConfig() {
      return {};
    },
  };
  const quotaProjectionService = {
    getUsedBytes() {
      return 600 * 1024 * 1024;
    },
  };
  const policyService = new StoragePolicyService({
    registry,
    quotaProjectionService,
  });

  assert.equal(policyService.isQuotaExceeded('storage-1'), true);
  assert.equal(policyService.isUploadAllowed('storage-1'), false);
});

test('StoragePolicyService 会优先返回渠道级上传限制', () => {
  const policyService = new StoragePolicyService({
    registry: {
      getStorageMeta() {
        return {
          enableSizeLimit: true,
          sizeLimitMB: 8,
          enableChunking: true,
          chunkSizeMB: 2,
          maxChunks: 4,
          enableMaxLimit: true,
          maxLimitMB: 32,
        };
      },
      getUploadConfig() {
        return {
          defaultSizeLimitMB: 10,
          defaultChunkSizeMB: 5,
          defaultMaxChunks: 10,
          defaultMaxLimitMB: 100,
        };
      },
      getConfig() {
        return {};
      },
    },
    quotaProjectionService: {
      getUsedBytes() {
        return 0;
      },
    },
  });

  assert.deepEqual(policyService.getEffectiveUploadLimits('storage-1'), {
    enableSizeLimit: true,
    sizeLimitMB: 8,
    enableChunking: true,
    chunkSizeMB: 2,
    maxChunks: 4,
    enableMaxLimit: true,
    maxLimitMB: 32,
  });
});

test('StorageRuntime.initialize 会按固定顺序执行且具备幂等性', async () => {
  const calls = [];
  const runtime = new StorageRuntime({
    registry: {
      async reload() {
        calls.push('registry.reload');
      },
      getStorage() {
        return null;
      },
      getStorageMeta() {
        return null;
      },
      getDefaultStorageId() {
        return null;
      },
      async testConnection() {
        return { ok: true };
      },
    },
    quotaProjectionService: {
      async loadQuotaFromCache() {
        calls.push('quota.loadQuotaFromCache');
      },
      async initUsageStats() {
        calls.push('quota.initUsageStats');
      },
      async applyPendingQuotaEvents(options) {
        calls.push(['quota.applyPendingQuotaEvents', options]);
      },
      async verifyQuotaConsistency() {
        calls.push('quota.verifyQuotaConsistency');
        return { consistent: true };
      },
      async rebuildAllQuotaStats() {
        calls.push('quota.rebuildAllQuotaStats');
      },
      getUsageStats() {
        return {};
      },
      getAllQuotaStats() {
        return {};
      },
      async getQuotaHistory() {
        return [];
      },
    },
    storagePolicyService: {
      isUploadAllowed() {
        return true;
      },
      getEffectiveUploadLimits() {
        return {};
      },
    },
    uploadSelector: {
      selectUploadChannel() {
        return 'storage-1';
      },
    },
    recoveryService: {
      async recoverPendingOperations() {
        calls.push('recovery.recoverPendingOperations');
      },
    },
    maintenanceScheduler: {
      async start() {
        calls.push('maintenance.start');
      },
      stop() {
        calls.push('maintenance.stop');
      },
      async refresh() {
        calls.push('maintenance.refresh');
      },
    },
  });

  await runtime.initialize();
  await runtime.initialize();

  assert.deepEqual(calls, [
    'registry.reload',
    'quota.loadQuotaFromCache',
    'quota.initUsageStats',
    ['quota.applyPendingQuotaEvents', {
      adjustUsageStats: false,
      recordSnapshots: true,
    }],
    'quota.verifyQuotaConsistency',
    'recovery.recoverPendingOperations',
  ]);
});

test('StorageRuntime.reload 与 startMaintenance 会分别委托维护器行为', async () => {
  const calls = [];
  const runtime = new StorageRuntime({
    registry: {
      async reload() {
        calls.push('registry.reload');
      },
      getStorage() {
        return null;
      },
      getStorageMeta() {
        return null;
      },
      getDefaultStorageId() {
        return 'storage-1';
      },
      async testConnection() {
        return { ok: true };
      },
    },
    quotaProjectionService: {
      async loadQuotaFromCache() {
        calls.push('quota.loadQuotaFromCache');
      },
      async initUsageStats() {
        calls.push('quota.initUsageStats');
      },
      async applyPendingQuotaEvents() {
        calls.push('quota.applyPendingQuotaEvents');
      },
      async verifyQuotaConsistency() {
        calls.push('quota.verifyQuotaConsistency');
        return { consistent: true };
      },
      async rebuildAllQuotaStats() {
        calls.push('quota.rebuildAllQuotaStats');
      },
      getUsageStats() {
        return {};
      },
      getAllQuotaStats() {
        return {};
      },
      async getQuotaHistory() {
        return [];
      },
    },
    storagePolicyService: {
      isUploadAllowed() {
        return true;
      },
      getEffectiveUploadLimits() {
        return {};
      },
    },
    uploadSelector: {
      selectUploadChannel() {
        return 'storage-1';
      },
    },
    recoveryService: {
      async recoverPendingOperations() {
        calls.push('recovery.recoverPendingOperations');
      },
    },
    maintenanceScheduler: {
      async start() {
        calls.push('maintenance.start');
      },
      stop() {
        calls.push('maintenance.stop');
      },
      async refresh() {
        calls.push('maintenance.refresh');
      },
    },
  });

  await runtime.startMaintenance();
  await runtime.reload();
  runtime.stopMaintenance();

  assert.deepEqual(calls, [
    'registry.reload',
    'quota.loadQuotaFromCache',
    'quota.initUsageStats',
    'quota.applyPendingQuotaEvents',
    'quota.verifyQuotaConsistency',
    'recovery.recoverPendingOperations',
    'maintenance.start',
    'registry.reload',
    'maintenance.refresh',
    'maintenance.stop',
  ]);
});
