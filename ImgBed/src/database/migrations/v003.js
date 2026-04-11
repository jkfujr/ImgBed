import { migrateStorageChannelsDeletedAt, migrateFilesStatus, rebuildQuotaCacheTriggers } from './v001.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('database:migrations:v003');

export function migrateDropRedundantFilesIndexes(db) {
  const indexes = db.prepare("PRAGMA index_list('files')").all();
  const existingIndexNames = new Set(indexes.map((index) => index.name));

  const redundantIndexes = [
    'idx_files_directory',
    'idx_files_dir_time',
    'idx_files_channel_time',
  ];

  for (const indexName of redundantIndexes) {
    if (existingIndexNames.has(indexName)) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
      log.info({ indexName }, '迁移：已删除 files 冗余索引');
    }
  }
}

export function migrateV003(db) {
  migrateStorageChannelsDeletedAt(db);
  migrateFilesStatus(db);
  rebuildQuotaCacheTriggers(db);
  migrateDropRedundantFilesIndexes(db);
}
