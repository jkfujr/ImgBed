const assert = require('node:assert/strict');
const { updateUploadConfig, applyStorageFieldUpdates } = require('../src/services/system/update-config-fields');
const { calculateQuotaStatsFromDB } = require('../src/services/system/calculate-quota-stats');
const fs = require('fs');
const path = require('path');

const testConfigPath = path.join(__dirname, 'test-quota-config.json');

function createDbRecorder(files = []) {
  return {
    api: {
      selectFrom(table) {
        assert.equal(table, 'files');
        return {
          select(columns) {
            return {
              async execute() {
                return files;
              },
            };
          },
        };
      },
    },
  };
}

async function testUpdateUploadConfig() {
  const cfg = { upload: { quotaCheckMode: 'auto' } };

  updateUploadConfig(cfg, {
    quotaCheckMode: 'always',
    fullCheckIntervalHours: 12,
    defaultSizeLimitMB: 20,
    defaultChunkSizeMB: 10,
    defaultMaxChunks: 5,
    defaultMaxLimitMB: 200,
    enableSizeLimit: true,
    enableChunking: false,
    enableMaxLimit: true,
  });

  assert.equal(cfg.upload.quotaCheckMode, 'always');
  assert.equal(cfg.upload.fullCheckIntervalHours, 12);
  assert.equal(cfg.upload.defaultSizeLimitMB, 20);
  assert.equal(cfg.upload.defaultChunkSizeMB, 10);
  assert.equal(cfg.upload.defaultMaxChunks, 5);
  assert.equal(cfg.upload.defaultMaxLimitMB, 200);
  assert.equal(cfg.upload.enableSizeLimit, true);
  assert.equal(cfg.upload.enableChunking, false);
  assert.equal(cfg.upload.enableMaxLimit, true);
}

async function testUpdateUploadConfigCreatesUploadObject() {
  const cfg = {};

  updateUploadConfig(cfg, {
    quotaCheckMode: 'always',
    defaultSizeLimitMB: 15,
  });

  assert.ok(cfg.upload);
  assert.equal(cfg.upload.quotaCheckMode, 'always');
  assert.equal(cfg.upload.defaultSizeLimitMB, 15);
}

async function testUpdateUploadConfigSkipsUndefined() {
  const cfg = { upload: { quotaCheckMode: 'auto', defaultSizeLimitMB: 10 } };

  updateUploadConfig(cfg, {
    quotaCheckMode: 'always',
  });

  assert.equal(cfg.upload.quotaCheckMode, 'always');
  assert.equal(cfg.upload.defaultSizeLimitMB, 10);
}

async function testApplyStorageFieldUpdates() {
  const existing = {
    name: 'Old Name',
    enabled: false,
    allowUpload: false,
    weight: 1,
    quotaLimitGB: 10,
    enableSizeLimit: false,
    sizeLimitMB: 10,
    enableChunking: false,
    chunkSizeMB: 5,
    maxChunks: 0,
    enableMaxLimit: false,
    maxLimitMB: 100,
  };

  applyStorageFieldUpdates(existing, {
    name: 'New Name',
    enabled: true,
    allowUpload: true,
    weight: 3,
    enableQuota: true,
    quotaLimitGB: 50,
    disableThresholdPercent: 90,
    enableSizeLimit: true,
    sizeLimitMB: 20,
    enableChunking: true,
    chunkSizeMB: 10,
    maxChunks: 10,
    enableMaxLimit: true,
    maxLimitMB: 200,
  });

  assert.equal(existing.name, 'New Name');
  assert.equal(existing.enabled, true);
  assert.equal(existing.allowUpload, true);
  assert.equal(existing.weight, 3);
  assert.equal(existing.quotaLimitGB, 50);
  assert.equal(existing.disableThresholdPercent, 90);
  assert.equal(existing.enableSizeLimit, true);
  assert.equal(existing.sizeLimitMB, 20);
  assert.equal(existing.enableChunking, true);
  assert.equal(existing.chunkSizeMB, 10);
  assert.equal(existing.maxChunks, 10);
  assert.equal(existing.enableMaxLimit, true);
  assert.equal(existing.maxLimitMB, 200);
}

async function testApplyStorageFieldUpdatesDisablesQuota() {
  const existing = { quotaLimitGB: 50, disableThresholdPercent: 90 };

  applyStorageFieldUpdates(existing, {
    enableQuota: false,
  });

  assert.equal(existing.quotaLimitGB, null);
}

async function testCalculateQuotaStatsFromDB() {
  const files = [
    { size: 1000, storage_config: '{"instance_id":"local-1"}', storage_channel: 'local' },
    { size: 2000, storage_config: '{"instance_id":"local-1"}', storage_channel: 'local' },
    { size: 3000, storage_config: '{"instance_id":"s3-1"}', storage_channel: 's3' },
  ];

  const cfg = {
    storage: {
      storages: [
        { id: 'local-1', type: 'local' },
        { id: 's3-1', type: 's3' },
      ],
    },
  };

  fs.writeFileSync(testConfigPath, JSON.stringify(cfg, null, 2), 'utf8');

  const db = createDbRecorder(files);
  const stats = await calculateQuotaStatsFromDB(db.api, testConfigPath);

  assert.equal(stats['local-1'], 3000);
  assert.equal(stats['s3-1'], 3000);

  fs.unlinkSync(testConfigPath);
}

async function testCalculateQuotaStatsWithLegacyFiles() {
  const files = [
    { size: 1000, storage_config: '{}', storage_channel: 'local' },
    { size: 2000, storage_config: '{}', storage_channel: 'local' },
  ];

  const cfg = {
    storage: {
      storages: [
        { id: 'local-1', type: 'local' },
      ],
    },
  };

  fs.writeFileSync(testConfigPath, JSON.stringify(cfg, null, 2), 'utf8');

  const db = createDbRecorder(files);
  const stats = await calculateQuotaStatsFromDB(db.api, testConfigPath);

  assert.equal(stats['local-1'], 3000);

  fs.unlinkSync(testConfigPath);
}

async function testCalculateQuotaStatsSkipsInvalidJSON() {
  const files = [
    { size: 1000, storage_config: 'invalid json', storage_channel: 'local' },
    { size: 2000, storage_config: '{"instance_id":"local-1"}', storage_channel: 'local' },
  ];

  const cfg = {
    storage: {
      storages: [
        { id: 'local-1', type: 'local' },
      ],
    },
  };

  fs.writeFileSync(testConfigPath, JSON.stringify(cfg, null, 2), 'utf8');

  const db = createDbRecorder(files);
  const stats = await calculateQuotaStatsFromDB(db.api, testConfigPath);

  assert.equal(stats['local-1'], 2000);

  fs.unlinkSync(testConfigPath);
}

async function main() {
  await testUpdateUploadConfig();
  await testUpdateUploadConfigCreatesUploadObject();
  await testUpdateUploadConfigSkipsUndefined();
  await testApplyStorageFieldUpdates();
  await testApplyStorageFieldUpdatesDisablesQuota();
  await testCalculateQuotaStatsFromDB();
  await testCalculateQuotaStatsWithLegacyFiles();
  await testCalculateQuotaStatsSkipsInvalidJSON();
  console.log('system config fields tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
