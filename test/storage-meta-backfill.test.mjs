import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

import { initSchema } from '../ImgBed/src/database/schema.js';
import { backfillStorageMeta } from '../ImgBed/src/database/storage-meta-backfill.js';

const require = createRequire(new URL('../ImgBed/package.json', import.meta.url));
const Database = require('better-sqlite3');

function createLegacyDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,
      storage_channel TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      storage_config JSON,
      upload_ip TEXT,
      upload_address TEXT,
      uploader_type TEXT,
      uploader_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      directory TEXT DEFAULT '/',
      tags JSON,
      is_public BOOLEAN DEFAULT FALSE,
      width INTEGER,
      height INTEGER,
      exif JSON,
      storage_instance_id TEXT,
      is_chunked BOOLEAN DEFAULT FALSE,
      chunk_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      storage_type TEXT NOT NULL,
      storage_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      storage_config JSON,
      size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
    'file-1',
    'file-1.jpg',
    'file-1.jpg',
    'image/jpeg',
    1024,
    'telegram',
    'telegram-file-id',
    JSON.stringify({
      extra_result: {
        messageId: 8,
        chatId: '-5244533769',
      },
    }),
    'telegram-1',
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
    'active'
  );

  db.prepare(`
    INSERT INTO chunks (
      file_id, chunk_index, storage_type, storage_id, storage_key, storage_config, size
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'file-1',
    0,
    'telegram',
    'telegram-1',
    'chunk-file-id',
    JSON.stringify({
      extra_result: {
        message_id: 9,
        chat_id: '-5244533769',
      },
    }),
    512
  );

  return db;
}

function testInitSchemaRenamesAndBackfillsLegacyStorageMeta() {
  const db = createLegacyDb();

  try {
    initSchema(db);

    const fileRow = db.prepare('SELECT storage_meta FROM files WHERE id = ?').get('file-1');
    const chunkRow = db.prepare('SELECT storage_meta FROM chunks WHERE file_id = ?').get('file-1');

    assert.equal(fileRow.storage_meta, JSON.stringify({
      deleteToken: {
        messageId: 8,
        chatId: '-5244533769',
      },
    }));
    assert.equal(chunkRow.storage_meta, JSON.stringify({
      deleteToken: {
        messageId: 9,
        chatId: '-5244533769',
      },
    }));
    console.log('  [OK] initSchema：旧 storage_config 自动重命名并回填为 canonical storage_meta');
  } finally {
    db.close();
  }
}

function testBackfillKeepsAlreadyCanonicalRowsStable() {
  const db = new Database(':memory:');

  try {
    initSchema(db);
    db.prepare(`
      INSERT INTO files (
        id, file_name, original_name, mime_type, size,
        storage_channel, storage_key, storage_meta, storage_instance_id,
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
      'file-2',
      'file-2.jpg',
      'file-2.jpg',
      'image/jpeg',
      1024,
      'telegram',
      'telegram-file-id',
      JSON.stringify({
        deleteToken: {
          messageId: 10,
          chatId: '-1',
        },
      }),
      'telegram-1',
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
      'active'
    );

    const result = backfillStorageMeta(db);
    const row = db.prepare('SELECT storage_meta FROM files WHERE id = ?').get('file-2');

    assert.deepEqual(result, { filesUpdated: 0, chunksUpdated: 0 });
    assert.equal(row.storage_meta, JSON.stringify({
      deleteToken: {
        messageId: 10,
        chatId: '-1',
      },
    }));
    console.log('  [OK] backfillStorageMeta：已 canonical 的记录不会被重复改写');
  } finally {
    db.close();
  }
}

function run() {
  console.log('\n== storage-meta backfill tests ==');
  testInitSchemaRenamesAndBackfillsLegacyStorageMeta();
  testBackfillKeepsAlreadyCanonicalRowsStable();
  console.log('\nstorage-meta-backfill tests passed\n');
}

run();
