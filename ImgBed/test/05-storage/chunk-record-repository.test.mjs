import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteByFileId,
  insertMany,
  listByFileId,
} from '../../src/storage/chunks/chunk-record-repository.js';
import { createTestDb, insertFileRecord } from '../helpers/storage-test-helpers.mjs';

test('chunk-record-repository 会写入、排序读取并按文件删除分块记录', async (t) => {
  const db = createTestDb();
  t.after(() => db.close());

  insertFileRecord(db, {
    id: 'file-1',
    storageKey: 'origin-key',
    storageInstanceId: 'storage-1',
  });

  insertMany([
    {
      file_id: 'file-1',
      chunk_index: 1,
      storage_type: 'mock',
      storage_id: 'storage-1',
      storage_key: 'chunk-1',
      storage_meta: null,
      size: 2,
    },
    {
      file_id: 'file-1',
      chunk_index: 0,
      storage_type: 'mock',
      storage_id: 'storage-1',
      storage_key: 'chunk-0',
      storage_meta: null,
      size: 3,
    },
  ], db);

  const listed = await listByFileId('file-1', db);
  assert.deepEqual(listed.map((item) => item.chunk_index), [0, 1]);

  deleteByFileId('file-1', db);
  const afterDelete = await listByFileId('file-1', db);
  assert.deepEqual(afterDelete, []);
});
