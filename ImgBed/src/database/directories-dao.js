/**
 * directories 表的数据访问层（DAO）。
 *
 * 所有函数以 db 作为第一参数（显式注入），
 * 不绑定 sqlite 单例，便于事务复用。
 */

// ─── 读操作 ───────────────────────────────────────────────

/**
 * 按 ID 查目录。
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {Object|undefined}
 */
function getDirectoryById(db, id) {
  return db.prepare('SELECT * FROM directories WHERE id = ?').get(id);
}

/**
 * 按 path 查目录（用于冲突检测和路径存在性校验）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} path
 * @returns {Object|undefined}
 */
function getDirectoryByPath(db, path) {
  return db.prepare('SELECT * FROM directories WHERE path = ? LIMIT 1').get(path);
}

/**
 * 获取所有目录（按 path 升序）。
 * @param {import('better-sqlite3').Database} db
 * @returns {Object[]}
 */
function getAllDirectories(db) {
  return db.prepare('SELECT * FROM directories ORDER BY path ASC').all();
}

/**
 * 获取指定路径前缀的所有子目录（目录重命名级联更新用）。
 * @param {import('better-sqlite3').Database} db
 * @param {string} parentPath - 父目录 path
 * @returns {Object[]}
 */
function getChildDirectoriesByPathPrefix(db, parentPath) {
  return db.prepare(
    'SELECT * FROM directories WHERE path LIKE ?'
  ).all(`${parentPath}/%`);
}

/**
 * 统计指定父目录下的直接子目录数量（删除前安全检查用）。
 * @param {import('better-sqlite3').Database} db
 * @param {number} parentId
 * @returns {number}
 */
function countChildDirectories(db, parentId) {
  const row = db.prepare(
    'SELECT COUNT(id) AS ct FROM directories WHERE parent_id = ?'
  ).get(parentId);
  return Number(row?.ct || 0);
}

// ─── 写操作 ───────────────────────────────────────────────

/**
 * 插入新目录。
 * @param {import('better-sqlite3').Database} db
 * @param {{ name: string, path: string, parentId: number|null }} param
 */
function insertDirectory(db, { name, path, parentId }) {
  return db.prepare(
    'INSERT INTO directories (name, path, parent_id) VALUES (?, ?, ?)'
  ).run(name.trim(), path, parentId ?? null);
}

/**
 * 更新目录的 name 和 path（重命名用）。
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ name: string, path: string }} param
 */
function updateDirectoryNameAndPath(db, id, { name, path }) {
  return db.prepare(
    'UPDATE directories SET name = ?, path = ? WHERE id = ?'
  ).run(name.trim(), path, id);
}

/**
 * 更新目录的 path（级联子目录路径更新用）。
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} newPath
 */
function updateDirectoryPath(db, id, newPath) {
  return db.prepare('UPDATE directories SET path = ? WHERE id = ?').run(newPath, id);
}

/**
 * 按 ID 删除目录。
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 */
function deleteDirectoryById(db, id) {
  return db.prepare('DELETE FROM directories WHERE id = ?').run(id);
}

export {
  getDirectoryById,
  getDirectoryByPath,
  getAllDirectories,
  getChildDirectoriesByPathPrefix,
  countChildDirectories,
  insertDirectory,
  updateDirectoryNameAndPath,
  updateDirectoryPath,
  deleteDirectoryById,
};
