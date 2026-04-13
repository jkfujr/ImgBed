import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

import { runMigrations, SCHEMA_VERSION } from '../ImgBed/src/database/migrate.js';
import { initSchema } from '../ImgBed/src/database/schema.js';

const require = createRequire(new URL('../ImgBed/package.json', import.meta.url));
const Database = require('better-sqlite3');

function getColumnNames(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function getIndexNames(db, tableName) {
  return db.prepare(`PRAGMA index_list(${tableName})`).all().map((index) => index.name);
}

function getQuotaTriggerNames(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_quota_cache_after_%'
    ORDER BY name ASC
  `).all().map((row) => row.name);
}

function testLatestSchemaIsEmbeddedInCreateTableDefinitions() {
  const db = new Database(':memory:');

  try {
    initSchema(db);

    assert.ok(
      getColumnNames(db, 'storage_operations').includes('retry_count'),
      'storage_operations DDL 必须直接包含 retry_count 字段'
    );
    assert.ok(
      getColumnNames(db, 'storage_channels').includes('deleted_at'),
      'storage_channels DDL 必须直接包含 deleted_at 字段'
    );
    assert.ok(
      getColumnNames(db, 'files').includes('status'),
      'files DDL 必须直接包含 status 字段'
    );
    assert.ok(
      getColumnNames(db, 'files').includes('storage_meta'),
      'files DDL 必须直接包含 storage_meta 字段'
    );
    assert.equal(
      getColumnNames(db, 'files').includes('storage_config'),
      false,
      'files DDL 不应继续保留旧 storage_config 字段'
    );
    assert.ok(
      getColumnNames(db, 'chunks').includes('storage_meta'),
      'chunks DDL 必须直接包含 storage_meta 字段'
    );
    assert.equal(
      getColumnNames(db, 'chunks').includes('storage_config'),
      false,
      'chunks DDL 不应继续保留旧 storage_config 字段'
    );

    const fileIndexes = getIndexNames(db, 'files');
    assert.equal(fileIndexes.includes('idx_files_directory'), false, 'files DDL 不应再创建旧索引 idx_files_directory');
    assert.equal(fileIndexes.includes('idx_files_dir_time'), false, 'files DDL 不应再创建旧索引 idx_files_dir_time');
    assert.equal(fileIndexes.includes('idx_files_channel_time'), false, 'files DDL 不应再创建旧索引 idx_files_channel_time');

    assert.deepEqual(
      getQuotaTriggerNames(db),
      [],
      '最新 schema 不应直接创建已被移除的 quota cache 触发器'
    );

    console.log('  [OK] 当前建表 DDL 直接体现最新字段与结构');
  } finally {
    db.close();
  }
}

function testSchemaVersionModulePinsDatabaseToV0() {
  const db = new Database(':memory:');

  try {
    initSchema(db);
    runMigrations(db);

    const versions = db.prepare(
      'SELECT version FROM schema_migrations ORDER BY version ASC'
    ).all().map((row) => row.version);
    assert.deepEqual(versions, [SCHEMA_VERSION], '数据库结构版本只应登记为单一 v0');

    console.log('  [OK] migration 模块仅登记单一 schema v0');
  } finally {
    db.close();
  }
}

function run() {
  console.log('\n== new database schema version alignment tests ==');
  testLatestSchemaIsEmbeddedInCreateTableDefinitions();
  testSchemaVersionModulePinsDatabaseToV0();
  console.log('\nnew-db-schema-version-alignment tests passed\n');
}

run();
