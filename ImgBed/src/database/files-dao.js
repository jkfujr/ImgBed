/**
 * files 表的数据访问层（DAO）。
 *
 * 所有函数以 db 作为第一参数（显式注入），
 * 不绑定 sqlite 单例，便于事务复用。
 *
 */

function buildActiveFilesWhere({ directory, search } = {}) {
  const conditions = ['status = ?'];
  const params = ['active'];

  if (directory !== undefined) {
    conditions.push('directory = ?');
    params.push(directory);
  }

  if (search) {
    conditions.push('file_name LIKE ?');
    params.push(`%${search}%`);
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

// ─── 读操作 ───────────────────────────────────────────────

/**
 * 按 ID 查单个 active 文件。
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {Object|undefined}
 */
function getActiveFileById(db, id) {
  return db.prepare(
    "SELECT * FROM files WHERE id = ? AND status = 'active' LIMIT 1"
  ).get(id);
}

/**
 * 按 ID 查单个文件（不过滤 status，用于恢复流程等内部操作）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {Object|undefined}
 */
function getFileById(db, id) {
  return db.prepare(
    'SELECT * FROM files WHERE id = ? LIMIT 1'
  ).get(id);
}

/**
 * 按 ID 数组批量查 active 文件。
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} ids
 * @returns {Object[]}
 */
function getActiveFilesByIds(db, ids) {
  if (!ids || ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(
    `SELECT * FROM files WHERE id IN (${placeholders}) AND status = 'active'`
  ).all(...ids);
}

/**
 * 按条件分页查询 active 文件列表。
 * @param {import('better-sqlite3').Database} db
 * @param {{ directory?: string, search?: string, limit: number, offset: number }} options
 * @returns {Object[]}
 */
function listActiveFiles(db, { directory, search = '', limit, offset } = {}) {
  const { whereClause, params } = buildActiveFilesWhere({ directory, search });
  return db.prepare(`
    SELECT id, file_name, original_name, mime_type, size,
           storage_channel, storage_key, storage_meta, storage_instance_id,
           upload_ip, upload_address, created_at, updated_at,
           directory, tags, is_public,
           width, height, uploader_type, uploader_id
    FROM files
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

/**
 * 按条件统计 active 文件总数。
 * @param {import('better-sqlite3').Database} db
 * @param {{ directory?: string, search?: string }} options
 * @returns {number}
 */
function countActiveFiles(db, { directory, search = '' } = {}) {
  const { whereClause, params } = buildActiveFilesWhere({ directory, search });
  const row = db.prepare(`SELECT COUNT(id) AS total FROM files ${whereClause}`).get(...params);
  return Number(row?.total || 0);
}

/**
 * 查询 active 文件的总数与总大小（dashboard 概览用）。
 * @param {import('better-sqlite3').Database} db
 * @returns {{ count: number, sum: number }}
 */
function getActiveFilesStats(db) {
  const row = db.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS sum FROM files WHERE status = 'active'"
  ).get();
  return { count: Number(row.count), sum: Number(row.sum) };
}

/**
 * 查询今日 active 文件上传数（dashboard 概览用）。
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
function getTodayUploadCount(db) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM files
     WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
     AND status = 'active'`
  ).get();
  return Number(row?.count || 0);
}

/**
 * 查询 active 文件按天上传趋势（dashboard 趋势图用）。
 * @param {import('better-sqlite3').Database} db
 * @param {7|30|90} days
 * @returns {Array<{ date: string, fileCount: number, totalSize: number }>}
 */
function getUploadTrend(db, days) {
  return db.prepare(`
    SELECT
      DATE(created_at, 'localtime') AS date,
      COUNT(*) AS fileCount,
      COALESCE(SUM(size), 0) AS totalSize
    FROM files
    WHERE created_at >= datetime('now', 'localtime', '-${days} days')
      AND status = 'active'
    GROUP BY DATE(created_at, 'localtime')
    ORDER BY date ASC
  `).all();
}

function buildMetadataRebuildWhere(force, afterId) {
  const conditions = ["mime_type LIKE 'image/%'"];
  const params = [];

  if (!force) {
    conditions.push('width IS NULL');
  }

  if (afterId) {
    conditions.push('id > ?');
    params.push(afterId);
  }

  return {
    whereClause: `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

/**
 * 统计需要重建图片元数据的文件数量。
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} force
 * @returns {number}
 */
function countImageFilesForMetadataRebuild(db, force) {
  const { whereClause, params } = buildMetadataRebuildWhere(force, null);
  const row = db.prepare(`SELECT COUNT(id) AS total FROM files ${whereClause}`).get(...params);
  return Number(row?.total || 0);
}

/**
 * 使用按 ID 的 keyset 分页读取待重建元数据的图片文件。
 * @param {import('better-sqlite3').Database} db
 * @param {{ force?: boolean, afterId?: string|null, limit?: number }} options
 * @returns {Object[]}
 */
function listImageFilesForMetadataRebuildAfter(db, {
  force = false,
  afterId = null,
  limit = 100,
} = {}) {
  const { whereClause, params } = buildMetadataRebuildWhere(force, afterId);
  return db.prepare(`
    SELECT *
    FROM files
    ${whereClause}
    ORDER BY id ASC
    LIMIT ?
  `).all(...params, limit);
}

// ─── 写操作 ───────────────────────────────────────────────

/**
 * 插入文件记录（上传流程）。
 * @param {import('better-sqlite3').Database} db
 * @param {Object} record - 完整的文件记录对象（字段名与数据库列名一致）
 */
function insertFile(db, record) {
  return db.prepare(`
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
  `).run(record);
}

/**
 * 按 ID 删除文件记录。
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
function deleteFileById(db, id) {
  return db.prepare('DELETE FROM files WHERE id = ?').run(id);
}

/**
 * 更新文件的存储渠道迁移字段（migrate 流程）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ storageChannel: string, storageKey: string, storageMeta: string|null, storageInstanceId: string, isChunked: number, chunkCount: number }} fields
 */
function updateFileMigrationFields(db, id, fields) {
  return db.prepare(`
    UPDATE files SET
      storage_channel = ?,
      storage_key = ?,
      storage_meta = ?,
      storage_instance_id = ?,
      is_chunked = ?,
      chunk_count = ?
    WHERE id = ?
  `).run(
    fields.storageChannel,
    fields.storageKey,
    fields.storageMeta,
    fields.storageInstanceId,
    fields.isChunked,
    fields.chunkCount,
    id
  );
}

/**
 * 按字段更新 active 文件。
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {Object} fields
 */
function updateActiveFileFields(db, id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return { changes: 0 };
  }

  const setClauses = keys.map((key) => `${key} = ?`).join(', ');
  const values = keys.map((key) => fields[key]);
  return db.prepare(
    `UPDATE files SET ${setClauses} WHERE id = ? AND status = 'active'`
  ).run(...values, id);
}

/**
 * 更新文件的图片元数据（rebuild-metadata 流程）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {{ width: number|null, height: number|null, exif: string|null }} meta
 */
function updateFileImageMetadata(db, id, { width, height, exif }) {
  return db.prepare(
    'UPDATE files SET width = ?, height = ?, exif = ? WHERE id = ?'
  ).run(width, height, exif, id);
}

/**
 * 将指定存储实例下所有 active 文件冻结为 channel_deleted（逻辑删除渠道时调用）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} storageInstanceId
 */
function freezeFilesByStorageInstance(db, storageInstanceId) {
  return db.prepare(
    "UPDATE files SET status = 'channel_deleted' WHERE storage_instance_id = ? AND status = 'active'"
  ).run(storageInstanceId);
}

/**
 * 冻结所有指向当前配置中不存在的存储实例的 active 文件。
 * 用于启动期修复配置与文件索引漂移，避免列表和直链继续暴露失效文件。
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} configuredIds
 */
function freezeFilesByMissingStorageInstances(db, configuredIds) {
  const activeIds = Array.from(new Set((configuredIds || []).filter(Boolean)));
  if (activeIds.length === 0) {
    return db.prepare(`
      UPDATE files
      SET status = 'channel_deleted'
      WHERE status = 'active'
        AND storage_instance_id IS NOT NULL
    `).run();
  }

  const placeholders = activeIds.map(() => '?').join(', ');
  return db.prepare(`
    UPDATE files
    SET status = 'channel_deleted'
    WHERE status = 'active'
      AND storage_instance_id IS NOT NULL
      AND storage_instance_id NOT IN (${placeholders})
  `).run(...activeIds);
}

/**
 * 批量将文件移动到指定目录。
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} ids
 * @param {string} directory
 */
function moveFilesToDirectory(db, ids, directory) {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(
    `UPDATE files SET directory = ? WHERE id IN (${placeholders})`
  ).run(directory, ...ids);
}

/**
 * 将旧目录路径下的所有文件的 directory 字段更新为新路径（目录重命名级联用）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} newDirectory
 * @param {string} oldDirectory
 */
function renameFileDirectory(db, newDirectory, oldDirectory) {
  return db.prepare('UPDATE files SET directory = ? WHERE directory = ?').run(newDirectory, oldDirectory);
}

/**
 * 记录文件访问日志。
 * @param {import('better-sqlite3').Database} db
 * @param {{ fileId: string, ip: string, userAgent: string|null, referer: string|null, isAdmin: number }} param
 */
function insertAccessLog(db, { fileId, ip, userAgent, referer, isAdmin }) {
  return db.prepare(
    'INSERT INTO access_logs (file_id, ip, user_agent, referer, is_admin) VALUES (?, ?, ?, ?, ?)'
  ).run(fileId, ip, userAgent, referer, isAdmin);
}

/**
 * 按目录路径前缀统计 active 文件数（删除目录前安全检查用）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} pathPrefix - 目录 path（含子目录，使用 LIKE prefix%）
 * @returns {number}
 */
function countFilesByDirectoryPrefix(db, pathPrefix) {
  const row = db.prepare(
    "SELECT COUNT(id) AS ct FROM files WHERE directory LIKE ? AND status = 'active'"
  ).get(`${pathPrefix}%`);
  return Number(row?.ct || 0);
}

export {
  countActiveFiles,
  countImageFilesForMetadataRebuild,
  getActiveFileById,
  getFileById,
  getActiveFilesByIds,
  listActiveFiles,
  getActiveFilesStats,
  getTodayUploadCount,
  getUploadTrend,
  listImageFilesForMetadataRebuildAfter,
  insertFile,
  deleteFileById,
  updateFileMigrationFields,
  updateActiveFileFields,
  updateFileImageMetadata,
  freezeFilesByStorageInstance,
  freezeFilesByMissingStorageInstances,
  moveFilesToDirectory,
  renameFileDirectory,
  insertAccessLog,
  countFilesByDirectoryPrefix,
};
