import { deleteFilesBatch } from './delete-file.js';
import { createFileMigrationService, createFilesError } from './migrate-file.js';
import { ensureExistingDirectoryPath, normalizeDirectoryPath } from '../../utils/directory-path.js';
import { getActiveFilesByIds, moveFilesToDirectory } from '../../database/files-dao.js';

function validateBatchIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createFilesError(400, '未附带任何将要施加作用的主键 [ids] 表');
  }
}

function normalizeTargetDirectory(targetDirectory, db) {
  try {
    const normalized = normalizeDirectoryPath(targetDirectory);
    ensureExistingDirectoryPath(normalized, db);
    return normalized;
  } catch (error) {
    throw createFilesError(400, `执行移动批处理时，target_directory 不合法：${error.message}`);
  }
}

async function moveFilesBatch(ids, targetDirectory, db) {
  const normalizedDirectory = normalizeTargetDirectory(targetDirectory, db);

  db.transaction(() => moveFilesToDirectory(db, ids, normalizedDirectory))();

  return {
    code: 0,
    message: `移库完成，已将 ${ids.length} 宗物品改签至 ${normalizedDirectory}`,
    data: {},
  };
}

async function executeFilesBatchAction({
  action,
  ids,
  targetDirectory,
  targetChannel,
  deleteMode,
  db,
  storageManager,
  fileMigrationService = null,
}) {
  validateBatchIds(ids);

  if (action === 'delete') {
    const files = getActiveFilesByIds(db, ids);
    const results = await deleteFilesBatch(files, { db, storageManager, deleteMode });
    return {
      code: 0,
      message: `删除完成：成功 ${results.success}，失败 ${results.failed}`,
      data: {
        ...results,
        deleted: results.success,
      },
    };
  }

  if (action === 'move') {
    return moveFilesBatch(ids, targetDirectory, db);
  }

  if (action === 'migrate') {
    const files = getActiveFilesByIds(db, ids);
    const migrationService = fileMigrationService || createFileMigrationService({
      db,
      storageManager,
    });
    const results = await migrationService.migrateFilesBatch(files, {
      targetChannel,
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
