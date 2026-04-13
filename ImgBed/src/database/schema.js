import { createLogger } from '../utils/logger.js';
import { createAccessLogsSchema } from './schemas/access-logs.js';
import { createApiTokensSchema } from './schemas/api-tokens.js';
import { createChunksSchema } from './schemas/chunks.js';
import { createDirectoriesSchema } from './schemas/directories.js';
import { createFilesSchema } from './schemas/files.js';
import { createStorageChannelsSchema } from './schemas/storage-channels.js';
import { createStorageOperationsSchema } from './schemas/storage-operations.js';
import { createStorageQuotaCacheSchema } from './schemas/storage-quota-cache.js';
import { createStorageQuotaEventsArchiveSchema } from './schemas/storage-quota-events-archive.js';
import { createStorageQuotaEventsSchema } from './schemas/storage-quota-events.js';
import { createStorageQuotaHistorySchema } from './schemas/storage-quota-history.js';
import { createSystemSettingsSchema } from './schemas/system-settings.js';
import { backfillStorageMeta } from './storage-meta-backfill.js';

const log = createLogger('database:schema');

export function initSchema(db) {
  try {
    createFilesSchema(db);
    createDirectoriesSchema(db);
    createSystemSettingsSchema(db);
    createApiTokensSchema(db);
    createStorageChannelsSchema(db);
    createStorageQuotaEventsSchema(db);
    createStorageOperationsSchema(db);
    createStorageQuotaHistorySchema(db);
    createStorageQuotaEventsArchiveSchema(db);
    createChunksSchema(db);
    createAccessLogsSchema(db);
    createStorageQuotaCacheSchema(db);
    backfillStorageMeta(db);

    log.info('数据库表结构初始化完成');
  } catch (err) {
    log.error({ err }, '数据库表结构初始化失败');
    throw err;
  }
}
