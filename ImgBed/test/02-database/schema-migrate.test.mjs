import assert from 'node:assert/strict';
import test from 'node:test';

import { runMigrations, SCHEMA_VERSION } from '../../src/database/migrate.js';
import { initSchema } from '../../src/database/schema.js';
import { getTableColumns, hasColumn, hasTable } from '../../src/database/schema-utils.js';
import { createEmptyDb, listTableNames, listTriggerNames } from '../helpers/database-test-helpers.mjs';

test('initSchema 会建立当前 v2 所需的全部核心数据表', (t) => {
  const db = createEmptyDb();
  t.after(() => db.close());

  initSchema(db);
  const tableNames = listTableNames(db);

  assert.deepEqual(
    tableNames.filter((name) => !name.startsWith('sqlite_')),
    [
      'access_logs',
      'api_tokens',
      'chunks',
      'directories',
      'files',
      'storage_operations',
      'storage_quota_cache',
      'storage_quota_events',
      'storage_quota_events_archive',
      'storage_quota_history',
    ],
  );
});

test('schema-utils 可以识别数据表和字段存在性', (t) => {
  const db = createEmptyDb();
  t.after(() => db.close());

  initSchema(db);

  assert.equal(hasTable(db, 'files'), true);
  assert.equal(hasTable(db, 'storage_channels'), false);
  assert.equal(hasColumn(db, 'files', 'storage_meta'), true);
  assert.equal(hasColumn(db, 'files', 'storage_config'), false);
  assert.deepEqual(
    getTableColumns(db, 'storage_operations'),
    [
      'id',
      'operation_type',
      'file_id',
      'status',
      'source_storage_id',
      'target_storage_id',
      'remote_payload',
      'compensation_payload',
      'error_message',
      'retry_count',
      'created_at',
      'updated_at',
    ],
  );
});

test('当前 schema 只包含 updated_at 维护触发器，不包含配额跨表触发器', (t) => {
  const db = createEmptyDb();
  t.after(() => db.close());

  initSchema(db);

  assert.deepEqual(
    listTriggerNames(db),
    [
      'update_api_tokens_updated_at',
      'update_chunks_updated_at',
      'update_directories_updated_at',
      'update_files_updated_at',
      'update_storage_operations_updated_at',
    ],
  );
});

test('runMigrations 不做旧版迁移，只验证当前 v2 结构并登记 schema_migrations', (t) => {
  const db = createEmptyDb();
  t.after(() => db.close());

  initSchema(db);
  runMigrations(db);

  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all();
  assert.deepEqual(rows, [{ version: SCHEMA_VERSION }]);
});

test('runMigrations 在发现已废弃数据表时会拒绝继续登记', (t) => {
  const db = createEmptyDb();
  t.after(() => db.close());

  initSchema(db);
  db.exec('CREATE TABLE storage_channels (id TEXT PRIMARY KEY)');

  assert.throws(() => runMigrations(db), /storage_channels/);
});

test('runMigrations 在发现缺失的 v2 字段时会拒绝继续登记', (t) => {
  const db = createEmptyDb();
  t.after(() => db.close());

  initSchema(db);
  db.exec('DROP TABLE storage_operations');
  db.exec(`
    CREATE TABLE storage_operations (
      id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL,
      file_id TEXT,
      status TEXT NOT NULL,
      source_storage_id TEXT,
      target_storage_id TEXT,
      remote_payload JSON,
      compensation_payload JSON,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  assert.throws(() => runMigrations(db), /storage_operations\.retry_count/);
});
