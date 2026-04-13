import { createLogger } from '../utils/logger.js';
import { parseStorageMeta, serializeStorageMeta } from '../utils/storage-meta.js';
import { hasColumn } from './schema-utils.js';

const log = createLogger('database:storage-meta');

function backfillTableStorageMeta(db, tableName) {
  if (!hasColumn(db, tableName, 'storage_meta')) {
    return 0;
  }

  const hasLegacyStorageConfig = hasColumn(db, tableName, 'storage_config');
  const selectSql = hasLegacyStorageConfig
    ? `SELECT id, storage_meta, storage_config FROM ${tableName}`
    : `SELECT id, storage_meta FROM ${tableName}`;
  const rows = db.prepare(selectSql).all();
  const updateStmt = db.prepare(`UPDATE ${tableName} SET storage_meta = ? WHERE id = ?`);
  let updated = 0;

  for (const row of rows) {
    const nextStorageMeta = serializeStorageMeta(
      parseStorageMeta(row.storage_meta, hasLegacyStorageConfig ? row.storage_config : null)
    );
    const currentStorageMeta = row.storage_meta ?? null;

    if ((nextStorageMeta ?? null) === currentStorageMeta) {
      continue;
    }

    updateStmt.run(nextStorageMeta, row.id);
    updated++;
  }

  return updated;
}

function backfillStorageMeta(db) {
  const filesUpdated = backfillTableStorageMeta(db, 'files');
  const chunksUpdated = backfillTableStorageMeta(db, 'chunks');

  if (filesUpdated > 0 || chunksUpdated > 0) {
    log.info({ filesUpdated, chunksUpdated }, '旧存储元数据已回填到 storage_meta.deleteToken');
  }

  return { filesUpdated, chunksUpdated };
}

export {
  backfillStorageMeta,
  backfillTableStorageMeta,
};
