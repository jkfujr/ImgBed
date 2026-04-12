import { createLogger } from '../utils/logger.js';
import { createFilesSchema } from './schemas/files.js';
import { createDirectoriesSchema } from './schemas/directories.js';
import { createSystemSettingsSchema } from './schemas/system-settings.js';
import { createChunksSchema } from './schemas/chunks.js';
import { createApiTokensSchema } from './schemas/api-tokens.js';
import { createStorageChannelsSchema } from './schemas/storage-channels.js';
import { createStorageQuotaEventsSchema } from './schemas/storage-quota-events.js';
import { createStorageOperationsSchema } from './schemas/storage-operations.js';
import { createStorageQuotaHistorySchema } from './schemas/storage-quota-history.js';
import { createStorageQuotaEventsArchiveSchema } from './schemas/storage-quota-events-archive.js';
import { createAccessLogsSchema } from './schemas/access-logs.js';
import { createStorageQuotaCacheSchema } from './schemas/storage-quota-cache.js';

const log = createLogger('database:schema');

/**
 * 按依赖顺序初始化所有表结构（等价于旧 initDb）。
 * 建表顺序约束：
 * 1. files - 最先，chunks/access_logs 依赖它
 * 2. 中间各表 - 无外键约束，顺序灵活
 * 3. chunks、access_logs - 外键引用 files(id)
 * 4. storage_quota_cache - 独立投影表，由 QuotaProjectionService 写入
 *
 * @param {import('better-sqlite3').Database} db
 */
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

    log.info('表结构初始化完成');
  } catch (err) {
    log.error({ err }, '初始化失败');
    throw err;
  }
}
