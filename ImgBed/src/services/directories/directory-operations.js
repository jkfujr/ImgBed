/**
 * 解析目录父路径
 */
async function resolveParentPath(parentId, sqlite) {
  if (!parentId) {
    return { parentPath: '/', parentIdToSave: null };
  }

  const parent = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(parentId);
  if (!parent) {
    const error = new Error('指定的父级目录不存在');
    error.status = 404;
    throw error;
  }

  return { parentPath: parent.path, parentIdToSave: parent.id };
}

/**
 * 检查路径是否已存在
 */
async function checkPathConflict(path, sqlite) {
  const exists = sqlite.prepare('SELECT * FROM directories WHERE path = ?').get(path);
  if (exists) {
    const error = new Error('该层级下同名目录已存在');
    error.status = 409;
    throw error;
  }
}

/**
 * 拼装安全物理路径
 */
function buildPath(parentPath, rawName) {
  const safeName = rawName.replace(/[\/\\]/g, '').trim();
  if (!parentPath || parentPath === '/') {
    return `/${safeName}`;
  }
  return `${parentPath}/${safeName}`;
}

/**
 * 递归更新子目录路径
 */
async function updateChildrenPaths(oldPath, newPath, sqlite) {
  const children = sqlite.prepare('SELECT * FROM directories WHERE path LIKE ?').all(`${oldPath}/%`);

  for (const child of children) {
    const updatedChildPath = child.path.replace(oldPath, newPath);
    sqlite.prepare('UPDATE directories SET path = ? WHERE id = ?').run(updatedChildPath, child.id);
    sqlite.prepare('UPDATE files SET directory = ? WHERE directory = ?').run(updatedChildPath, child.path);
  }
}

/**
 * 重命名目录并级联更新子目录和文件
 */
async function renameDirectory(id, newName, sqlite) {
  const targetDir = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(id);
  if (!targetDir) {
    const error = new Error('修改对象不存在');
    error.status = 404;
    throw error;
  }

  const oldPath = targetDir.path;

  let parentPath = '/';
  if (targetDir.parent_id) {
    const parent = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(targetDir.parent_id);
    if (parent) parentPath = parent.path;
  }

  const newPath = buildPath(parentPath, newName);

  if (oldPath !== newPath) {
    const exist = sqlite.prepare('SELECT id FROM directories WHERE path = ?').get(newPath);
    if (exist) {
      const error = new Error('该级别已存在此同名目录');
      error.status = 409;
      throw error;
    }
  }

  sqlite.prepare('UPDATE directories SET name = ?, path = ? WHERE id = ?')
    .run(newName.trim(), newPath, id);

  if (oldPath !== newPath) {
    sqlite.prepare('UPDATE files SET directory = ? WHERE directory = ?').run(newPath, oldPath);

    await updateChildrenPaths(oldPath, newPath, sqlite);
  }

  return { id, name: newName.trim(), path: newPath };
}

export { resolveParentPath,
  checkPathConflict,
  buildPath,
  updateChildrenPaths,
  renameDirectory, };
