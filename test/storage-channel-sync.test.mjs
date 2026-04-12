import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

import { initSchema } from '../ImgBed/src/database/schema.js';
import { syncAllStorageChannels } from '../ImgBed/src/services/system/storage-channel-sync.js';

const require = createRequire(new URL('../ImgBed/package.json', import.meta.url));
const Database = require('better-sqlite3');

function createDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertStorageChannel(db, {
  id,
  name = id,
  type = 'local',
  enabled = 1,
  allowUpload = 1,
  weight = 1,
  quotaLimitGB = null,
  deletedAt = null,
}) {
  db.prepare(`
    INSERT INTO storage_channels (
      id, name, type, enabled, allow_upload, weight, quota_limit_gb, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, enabled, allowUpload, weight, quotaLimitGB, deletedAt);
}

function insertFile(db, {
  id,
  storageChannel = 'local',
  storageInstanceId = 'local-1',
  status = 'active',
}) {
  db.prepare(`
    INSERT INTO files (
      id, file_name, original_name, mime_type, size,
      storage_channel, storage_key, storage_config, storage_instance_id,
      upload_ip, upload_address, uploader_type, uploader_id,
      directory, tags, is_public, is_chunked, chunk_count,
      width, height, exif, status
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    id,
    `${id}.jpg`,
    `${id}.jpg`,
    'image/jpeg',
    1024,
    storageChannel,
    `${id}.jpg`,
    JSON.stringify({ instance_id: storageInstanceId }),
    storageInstanceId,
    '127.0.0.1',
    '{}',
    'admin_jwt',
    'admin',
    '/',
    null,
    0,
    0,
    0,
    null,
    null,
    null,
    status
  );
}

function getFileStatus(db, id) {
  return db.prepare('SELECT status FROM files WHERE id = ?').get(id)?.status;
}

function getStorageChannel(db, id) {
  return db.prepare('SELECT * FROM storage_channels WHERE id = ?').get(id);
}

async function testSyncMarksMissingConfiguredChannelsDeletedAndFreezesFiles() {
  const db = createDb();

  insertStorageChannel(db, { id: 'local-1', name: 'Local 1', type: 'local' });
  insertStorageChannel(db, { id: 's3', name: 'S3', type: 's3' });
  insertFile(db, { id: 'local-file', storageChannel: 'local', storageInstanceId: 'local-1' });
  insertFile(db, { id: 's3-file', storageChannel: 's3', storageInstanceId: 's3' });

  syncAllStorageChannels({
    storage: {
      storages: [
        {
          id: 'local-1',
          name: 'Local 1',
          type: 'local',
          enabled: true,
          allowUpload: true,
          weight: 1,
          quotaLimitGB: null,
        },
      ],
    },
  }, db);

  const deletedChannel = getStorageChannel(db, 's3');
  assert.equal(deletedChannel.enabled, 0);
  assert.equal(deletedChannel.allow_upload, 0);
  assert.ok(deletedChannel.deleted_at);
  assert.equal(getFileStatus(db, 's3-file'), 'channel_deleted');
  assert.equal(getFileStatus(db, 'local-file'), 'active');
  console.log('  [OK] storage-channel-sync: 缺失配置的渠道会被逻辑删除并冻结关联文件');
}

async function testSyncFreezesFilesWhoseStorageRowIsMissing() {
  const db = createDb();

  insertStorageChannel(db, { id: 'local-1', name: 'Local 1', type: 'local' });
  insertFile(db, { id: 'orphan-file', storageChannel: 's3', storageInstanceId: 'ghost-s3' });
  insertFile(db, { id: 'local-file', storageChannel: 'local', storageInstanceId: 'local-1' });

  syncAllStorageChannels({
    storage: {
      storages: [
        {
          id: 'local-1',
          name: 'Local 1',
          type: 'local',
          enabled: true,
          allowUpload: true,
          weight: 1,
          quotaLimitGB: null,
        },
      ],
    },
  }, db);

  assert.equal(getFileStatus(db, 'orphan-file'), 'channel_deleted');
  assert.equal(getFileStatus(db, 'local-file'), 'active');
  console.log('  [OK] storage-channel-sync: 缺失渠道行的孤儿文件会被冻结');
}

async function testSyncDoesNotRevivePreviouslyDeletedChannel() {
  const db = createDb();

  insertStorageChannel(db, {
    id: 's3',
    name: 'S3',
    type: 's3',
    enabled: 0,
    allowUpload: 0,
    deletedAt: '2026-04-12 00:00:00',
  });

  syncAllStorageChannels({
    storage: {
      storages: [
        {
          id: 's3',
          name: 'S3',
          type: 's3',
          enabled: false,
          allowUpload: false,
          weight: 1,
          quotaLimitGB: null,
        },
      ],
    },
  }, db);

  const deletedChannel = getStorageChannel(db, 's3');
  assert.equal(deletedChannel.enabled, 0);
  assert.equal(deletedChannel.allow_upload, 0);
  assert.equal(deletedChannel.deleted_at, '2026-04-12 00:00:00');
  console.log('  [OK] storage-channel-sync: 已逻辑删除渠道不会在启动同步时被复活');
}

async function main() {
  console.log('running storage-channel-sync tests...');
  await testSyncMarksMissingConfiguredChannelsDeletedAndFreezesFiles();
  await testSyncFreezesFilesWhoseStorageRowIsMissing();
  await testSyncDoesNotRevivePreviouslyDeletedChannel();
  console.log('storage-channel-sync tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
