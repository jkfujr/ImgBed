import { createRequire } from 'node:module';

import { createChunksSchema } from '../../src/database/schemas/chunks.js';
import { createFilesSchema } from '../../src/database/schemas/files.js';
import { createStorageOperationsSchema } from '../../src/database/schemas/storage-operations.js';
import { createStorageQuotaEventsSchema } from '../../src/database/schemas/storage-quota-events.js';
import { serializeStorageMeta } from '../../src/utils/storage-meta.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function parseStoredJson(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  return JSON.parse(rawValue);
}

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createStorageOperationsSchema(db);
  createStorageQuotaEventsSchema(db);
  createFilesSchema(db);
  createChunksSchema(db);
  return db;
}

function getStorageOperation(db, operationId) {
  const row = db.prepare('SELECT * FROM storage_operations WHERE id = ? LIMIT 1').get(operationId);
  if (!row) {
    return null;
  }

  return {
    ...row,
    remote_payload: parseStoredJson(row.remote_payload),
    compensation_payload: parseStoredJson(row.compensation_payload),
  };
}

function getQuotaEvents(db, operationId) {
  return db.prepare(`
    SELECT * FROM storage_quota_events
    WHERE operation_id = ?
    ORDER BY id ASC
  `).all(operationId).map((row) => ({
    ...row,
    payload: parseStoredJson(row.payload),
  }));
}

function insertFileRecord(db, {
  id = 'file-1',
  fileName = 'file-1.png',
  originalName = 'file-1.png',
  mimeType = 'image/png',
  size = 123,
  storageChannel = 'mock',
  storageKey = 'remote-key',
  storageInstanceId = 'storage-1',
  deleteToken = null,
  isChunked = 0,
  chunkCount = 0,
  status = 'active',
} = {}) {
  db.prepare(`
    INSERT INTO files (
      id, file_name, original_name, mime_type, size,
      storage_channel, storage_key, storage_meta, storage_instance_id,
      upload_ip, upload_address, uploader_type, uploader_id,
      directory, tags, is_public, is_chunked, chunk_count,
      width, height, exif, status
    ) VALUES (
      @id, @file_name, @original_name, @mime_type, @size,
      @storage_channel, @storage_key, @storage_meta, @storage_instance_id,
      @upload_ip, @upload_address, @uploader_type, @uploader_id,
      @directory, @tags, @is_public, @is_chunked, @chunk_count,
      @width, @height, @exif, @status
    )
  `).run({
    id,
    file_name: fileName,
    original_name: originalName,
    mime_type: mimeType,
    size,
    storage_channel: storageChannel,
    storage_key: storageKey,
    storage_meta: serializeStorageMeta({ deleteToken }),
    storage_instance_id: storageInstanceId,
    upload_ip: '127.0.0.1',
    upload_address: '{}',
    uploader_type: 'test',
    uploader_id: 'tester',
    directory: '/',
    tags: null,
    is_public: 1,
    is_chunked: isChunked,
    chunk_count: chunkCount,
    width: null,
    height: null,
    exif: null,
    status,
  });
}

function createStorageManagerDouble({
  deleteResult = true,
  deleteImpl = null,
  applyPendingQuotaEventsImpl = null,
} = {}) {
  const deleteCalls = [];
  const applyQuotaCalls = [];

  return {
    calls: {
      deleteCalls,
      applyQuotaCalls,
    },
    manager: {
      async applyPendingQuotaEvents(args) {
        applyQuotaCalls.push(args);
        if (typeof applyPendingQuotaEventsImpl === 'function') {
          return applyPendingQuotaEventsImpl(args);
        }

        return {
          applied: 0,
          storageIds: [],
        };
      },
      getStorage(storageId) {
        return {
          async delete(storageKey, deleteToken) {
            const call = { storageId, storageKey, deleteToken };
            deleteCalls.push(call);

            if (typeof deleteImpl === 'function') {
              return deleteImpl(call);
            }

            return deleteResult;
          },
        };
      },
    },
  };
}

export {
  createStorageManagerDouble,
  createTestDb,
  getQuotaEvents,
  getStorageOperation,
  insertFileRecord,
  parseStoredJson,
};
