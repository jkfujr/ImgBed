/**
 * files 表的数据访问层（DAO）。
 *
 * 所有函数以 db 作为第一参数（显式注入），
 * 不绑定 sqlite 单例，便于事务复用。
 *
 * 不封装的操作：
 * - 动态 WHERE 列表分页查询（routes/files.js，只出现一次）
 * - 动态 SET 字段更新（PUT /api/files/:id，字段运行时确定）
 */

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
    "SELECT COUNT(*) AS count FROM files WHERE DATE(created_at) = DATE('now') AND status = 'active'"
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
      DATE(created_at) AS date,
      COUNT(*) AS fileCount,
      COALESCE(SUM(size), 0) AS totalSize
    FROM files
    WHERE created_at >= datetime('now', '-${days} days') AND status = 'active'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();
}

/**
 * 查询需要重建图片元数据的文件。
 * @param {import('better-sqlite3').Database} db
 * @param {boolean} force - true 查全部图片，false 仅查 width IS NULL 的
 * @returns {Object[]}
 */
function getImageFilesForMetadataRebuild(db, force) {
  const sql = force
    ? "SELECT * FROM files WHERE mime_type LIKE 'image/%'"
    : "SELECT * FROM files WHERE mime_type LIKE 'image/%' AND width IS NULL";
  return db.prepare(sql).all();
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
      storage_channel, storage_key, storage_config, storage_instance_id,
      upload_ip, upload_address, uploader_type, uploader_id,
      directory, tags, is_public, is_chunked, chunk_count,
      width, height, exif, status
    ) VALUES (
      @id, @file_name, @original_name, @mime_type, @size,
      @storage_channel, @storage_key, @storage_config, @storage_instance_id,
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
 * @param {{ storageChannel: string, storageKey: string, storageConfig: string, storageInstanceId: string, isChunked: number, chunkCount: number }} fields
 */
function updateFileMigrationFields(db, id, fields) {
  return db.prepare(`
    UPDATE files SET
      storage_channel = ?,
      storage_key = ?,
      storage_config = ?,
      storage_instance_id = ?,
      is_chunked = ?,
      chunk_count = ?
    WHERE id = ?
  `).run(
    fields.storageChannel,
    fields.storageKey,
    fields.storageConfig,
    fields.storageInstanceId,
    fields.isChunked,
    fields.chunkCount,
    id
  );
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
  getActiveFileById,
  getFileById,
  getActiveFilesByIds,
  getActiveFilesStats,
  getTodayUploadCount,
  getUploadTrend,
  getImageFilesForMetadataRebuild,
  insertFile,
  deleteFileById,
  updateFileMigrationFields,
  updateFileImageMetadata,
  freezeFilesByStorageInstance,
  moveFilesToDirectory,
  renameFileDirectory,
  insertAccessLog,
  countFilesByDirectoryPrefix,
};
