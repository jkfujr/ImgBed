const assert = require('node:assert/strict');
const { readSystemConfig, writeSystemConfig, syncAllowedUploadChannels } = require('../src/services/system/config-io');
const { insertStorageChannelMeta, updateStorageChannelMeta, deleteStorageChannelMeta } = require('../src/services/system/storage-channel-sync');
const { applyStorageConfigChange } = require('../src/services/system/apply-storage-config');
const fs = require('fs');
const path = require('path');

const testConfigPath = path.join(__dirname, 'test-config.json');

function createTestConfig() {
  return {
    storage: {
      storages: [
        { id: 'local-1', type: 'local', enabled: true, allowUpload: true },
        { id: 's3-1', type: 's3', enabled: true, allowUpload: false },
      ],
      allowedUploadChannels: [],
      default: 'local-1',
    },
  };
}

function createDbRecorder() {
  const insertedRows = [];
  const updatedRows = [];
  const deletedIds = [];

  return {
    insertedRows,
    updatedRows,
    deletedIds,
    api: {
      insertInto(table) {
        assert.equal(table, 'storage_channels');
        return {
          values(payload) {
            return {
              async execute() {
                insertedRows.push(payload);
              },
            };
          },
        };
      },
      updateTable(table) {
        assert.equal(table, 'storage_channels');
        return {
          set(payload) {
            return {
              where(column, operator, value) {
                return {
                  async execute() {
                    updatedRows.push({ column, operator, value, payload });
                  },
                };
              },
            };
          },
        };
      },
      deleteFrom(table) {
        return {
          where(column, operator, value) {
            return {
              async execute() {
                deletedIds.push({ table, column, operator, value });
              },
            };
          },
        };
      },
    },
  };
}

function createStorageManager() {
  return {
    reloadCount: 0,
    async reload() {
      this.reloadCount++;
    },
  };
}

async function testReadWriteSystemConfig() {
  const cfg = createTestConfig();
  writeSystemConfig(testConfigPath, cfg);
  const read = readSystemConfig(testConfigPath);
  assert.deepEqual(read, cfg);
  fs.unlinkSync(testConfigPath);
}

async function testSyncAllowedUploadChannels() {
  const cfg = createTestConfig();
  syncAllowedUploadChannels(cfg);
  assert.deepEqual(cfg.storage.allowedUploadChannels, ['local-1']);
}

async function testInsertStorageChannelMeta() {
  const db = createDbRecorder();
  const storage = {
    id: 'test-1',
    name: 'Test Storage',
    type: 'local',
    enabled: true,
    allowUpload: false,
    weight: 2,
    quotaLimitGB: 50,
  };

  await insertStorageChannelMeta(storage, db.api);
  assert.equal(db.insertedRows.length, 1);
  assert.equal(db.insertedRows[0].id, 'test-1');
  assert.equal(db.insertedRows[0].name, 'Test Storage');
  assert.equal(db.insertedRows[0].enabled, 1);
  assert.equal(db.insertedRows[0].allow_upload, 0);
}

async function testUpdateStorageChannelMeta() {
  const db = createDbRecorder();
  const storage = {
    name: 'Updated Name',
    enabled: false,
    allowUpload: true,
    weight: 3,
    quotaLimitGB: 100,
  };

  await updateStorageChannelMeta('test-1', storage, db.api);
  assert.equal(db.updatedRows.length, 1);
  assert.equal(db.updatedRows[0].value, 'test-1');
  assert.equal(db.updatedRows[0].payload.name, 'Updated Name');
  assert.equal(db.updatedRows[0].payload.enabled, 0);
  assert.equal(db.updatedRows[0].payload.allow_upload, 1);
}

async function testDeleteStorageChannelMeta() {
  const db = createDbRecorder();
  await deleteStorageChannelMeta('test-1', db.api);
  assert.equal(db.deletedIds.length, 2);
  assert.equal(db.deletedIds[0].table, 'storage_channels');
  assert.equal(db.deletedIds[0].value, 'test-1');
  assert.equal(db.deletedIds[1].table, 'storage_quota_history');
  assert.equal(db.deletedIds[1].value, 'test-1');
}

async function testApplyStorageConfigChange() {
  const cfg = createTestConfig();
  writeSystemConfig(testConfigPath, cfg);
  const storageManager = createStorageManager();

  await applyStorageConfigChange({ cfg, configPath: testConfigPath, storageManager });

  assert.deepEqual(cfg.storage.allowedUploadChannels, ['local-1']);
  const saved = readSystemConfig(testConfigPath);
  assert.deepEqual(saved.storage.allowedUploadChannels, ['local-1']);
  assert.equal(storageManager.reloadCount, 1);

  fs.unlinkSync(testConfigPath);
}

async function main() {
  await testReadWriteSystemConfig();
  await testSyncAllowedUploadChannels();
  await testInsertStorageChannelMeta();
  await testUpdateStorageChannelMeta();
  await testDeleteStorageChannelMeta();
  await testApplyStorageConfigChange();
  console.log('system services tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
