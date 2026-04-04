/**
 * 解析目录父路径
 */
async function resolveParentPath(parentId, db) {
  if (!parentId) {
    return { parentPath: '/', parentIdToSave: null };
  }

  const parent = await db.selectFrom('directories').selectAll().where('id', '=', parentId).executeTakeFirst();
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
async function checkPathConflict(path, db) {
  const exists = await db.selectFrom('directories').selectAll().where('path', '=', path).executeTakeFirst();
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
async function updateChildrenPaths(oldPath, newPath, db) {
  const children = await db.selectFrom('directories').selectAll().where('path', 'like', `${oldPath}/%`).execute();

  for (const child of children) {
    const updatedChildPath = child.path.replace(oldPath, newPath);
    await db.updateTable('directories').set({ path: updatedChildPath }).where('id', '=', child.id).execute();
    await db.updateTable('files').set({ directory: updatedChildPath }).where('directory', '=', child.path).execute();
  }
}

/**
 * 重命名目录并级联更新子目录和文件
 */
async function renameDirectory(id, newName, db) {
  const targetDir = await db.selectFrom('directories').selectAll().where('id', '=', id).executeTakeFirst();
  if (!targetDir) {
    const error = new Error('修改对象不存在');
    error.status = 404;
    throw error;
  }

  const oldPath = targetDir.path;

  let parentPath = '/';
  if (targetDir.parent_id) {
    const parent = await db.selectFrom('directories').selectAll().where('id', '=', targetDir.parent_id).executeTakeFirst();
    if (parent) parentPath = parent.path;
  }

  const newPath = buildPath(parentPath, newName);

  if (oldPath !== newPath) {
    const exist = await db.selectFrom('directories').select('id').where('path', '=', newPath).executeTakeFirst();
    if (exist) {
      const error = new Error('该级别已存在此同名目录');
      error.status = 409;
      throw error;
    }
  }

  await db.updateTable('directories')
    .set({ name: newName.trim(), path: newPath })
    .where('id', '=', id)
    .execute();

  if (oldPath !== newPath) {
    await db.updateTable('files')
      .set({ directory: newPath })
      .where('directory', '=', oldPath)
      .execute();

    await updateChildrenPaths(oldPath, newPath, db);
  }

  return { id, name: newName.trim(), path: newPath };
}

module.exports = {
  resolveParentPath,
  checkPathConflict,
  buildPath,
  updateChildrenPaths,
  renameDirectory,
};
