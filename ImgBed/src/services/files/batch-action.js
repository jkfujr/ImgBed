import { deleteFilesBatch } from './delete-file.js';
import { createFilesError, migrateFilesBatch } from './migrate-file.js';

function validateBatchIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createFilesError(400, '未附带任何将要施加作用的主键 [ids] 表');
  }
}

async function moveFilesBatch(ids, targetDirectory, db) {
  if (targetDirectory === undefined) {
    throw createFilesError(400, '执行移动批处理时，必须连通带有目标目录 (target_directory) 指针');
  }

  const placeholders = ids.map(() => '?').join(', ');
  const runMove = () => db.prepare(
    `UPDATE files SET directory = ? WHERE id IN (${placeholders})`
  ).run(targetDirectory, ...ids);

  db.transaction(runMove)();

  return {
    code: 0,
    message: `移库完成，已将 ${ids.length} 宗物品改签至 ${targetDirectory}`,
    data: {},
  };
}

async function executeFilesBatchAction({ action, ids, targetDirectory, targetChannel, db, storageManager, ChunkManager }) {
  validateBatchIds(ids);

  if (action === 'delete') {
    const placeholders = ids.map(() => '?').join(', ');
    const files = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...ids);
    const deletedCount = await deleteFilesBatch(files, { db, storageManager, ChunkManager });
    return {
      code: 0,
      message: `完毕，已成功清除 ${deletedCount} 份上传档案`,
      data: { deleted: deletedCount },
    };
  }

  if (action === 'move') {
    return moveFilesBatch(ids, targetDirectory, db);
  }

  if (action === 'migrate') {
    const placeholders = ids.map(() => '?').join(', ');
    const files = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...ids);
    const results = await migrateFilesBatch(files, {
      targetChannel,
      db,
      storageManager,
    });

    return {
      code: 0,
      message: `迁移完成：成功 ${results.success}，失败 ${results.failed}，跳过 ${results.skipped}`,
      data: results,
    };
  }

  throw createFilesError(400, '暂不允许执行此处未作解析约定的行为指令(仅支持 delete/move/migrate)');
}

export { executeFilesBatchAction,
  moveFilesBatch,
  validateBatchIds, };
