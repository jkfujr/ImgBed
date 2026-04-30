import { createLogger } from '../../utils/logger.js';
import { ConflictError, ValidationError } from '../../errors/AppError.js';
import { normalizeStorageDeleteFileAction } from './storage-delete-files-action.js';
import {
  countActiveFilesByStorageInstance,
  freezeActiveFileByIdAndStorageInstance,
  getFileById,
  listActiveFilesByStorageInstanceAfter,
} from '../../database/files-dao.js';
import {
  createTaskLog,
  finishTaskLog,
  getTaskLogById,
  insertTaskLogItem,
  markActiveTaskItemsStopped,
  startTaskLog,
  stopTaskLog,
  updateTaskLogItem,
  updateTaskLogTotals,
} from '../../database/task-logs-dao.js';
import { deleteFileRecord as defaultDeleteFileRecord } from '../files/delete-file.js';
import { defaultMaintenanceTaskExecutor } from '../maintenance/default-maintenance-task-executor.js';
import { TaskStopError } from '../maintenance/maintenance-task-executor.js';

const STORAGE_DELETE_FILES_TASK_NAME = 'storage-delete-files';
const STORAGE_DELETE_FILES_TASK_TYPE = 'storage_delete_files';
const STORAGE_DELETE_FILES_BATCH_SIZE = 100;
const STORAGE_DELETE_FILES_STOP_MESSAGES = {
  cancel: '用户取消任务',
};

function assertNoRunningStorageDeleteFiles(taskExecutor) {
  const currentSnapshot = typeof taskExecutor.getSnapshot === 'function'
    ? taskExecutor.getSnapshot(STORAGE_DELETE_FILES_TASK_NAME)
    : null;
  if (currentSnapshot?.runId && !currentSnapshot?.endedAt) {
    throw new ConflictError('已有删除渠道文件处理任务正在运行，请稍后再试', 'STORAGE_DELETE_FILES_RUNNING');
  }
}

function buildTaskResultStatus(stats) {
  if (stats.failed > 0) {
    return stats.success > 0 || stats.skipped > 0 ? 'partial_failed' : 'failed';
  }
  return 'completed';
}

function buildErrorSummary(errors, limit = 10) {
  return errors.slice(0, limit).map((item) => `${item.id}: ${item.reason}`).join('\n') || null;
}

function createStorageDeleteFilesTaskDefinition({
  db,
  storageManager,
  logger = createLogger('tasks'),
  deleteFileRecord = defaultDeleteFileRecord,
  applyPendingQuotaEvents = undefined,
  countFilesByStorageInstance = countActiveFilesByStorageInstance,
  listFilesByStorageInstanceAfter = listActiveFilesByStorageInstanceAfter,
  freezeFileByIdAndStorageInstance = freezeActiveFileByIdAndStorageInstance,
  getFile = getFileById,
  invalidateFilesCache = () => {},
  invalidateStorageCaches = () => {},
  invalidateDashboardCaches = () => {},
  batchSize = STORAGE_DELETE_FILES_BATCH_SIZE,
} = {}) {
  async function processFile(file, {
    taskId,
    sourceStorageId,
    fileAction,
  }) {
    const itemId = insertTaskLogItem(db, {
      taskId,
      fileId: file.id,
      status: 'running',
    });

    try {
      const currentFile = getFile(db, file.id);
      if (
        !currentFile
        || currentFile.status !== 'active'
        || currentFile.storage_instance_id !== sourceStorageId
      ) {
        updateTaskLogItem(db, itemId, {
          status: 'skipped',
          attemptCount: 1,
        });
        return { status: 'skipped' };
      }

      if (fileAction === 'freeze') {
        const result = freezeFileByIdAndStorageInstance(db, currentFile.id, sourceStorageId);
        if (Number(result?.changes || 0) === 0) {
          updateTaskLogItem(db, itemId, {
            status: 'skipped',
            attemptCount: 1,
          });
          return { status: 'skipped' };
        }
      } else {
        await deleteFileRecord(currentFile, {
          db,
          storageManager,
          applyPendingQuotaEvents,
          deleteMode: 'index_only',
        });
      }

      updateTaskLogItem(db, itemId, {
        status: 'success',
        attemptCount: 1,
      });
      return { status: 'success' };
    } catch (error) {
      const reason = error?.message || String(error || '处理失败');
      updateTaskLogItem(db, itemId, {
        status: 'failed',
        attemptCount: 1,
        lastError: reason,
      });
      return { status: 'failed', reason };
    }
  }

  function stopFromRuntime(taskId, taskRuntime) {
    const stopRequest = taskRuntime.getStopRequest?.();
    if (!stopRequest) {
      return null;
    }

    const reason = stopRequest.reason || STORAGE_DELETE_FILES_STOP_MESSAGES[stopRequest.action] || '任务已停止';
    stopTaskLog(db, taskId, {
      status: stopRequest.status,
      reason,
    });
    markActiveTaskItemsStopped(db, taskId, {
      status: stopRequest.status,
      reason,
    });
    return {
      status: stopRequest.status,
      reason,
    };
  }

  return {
    name: STORAGE_DELETE_FILES_TASK_NAME,
    concurrency: 2,
    itemDelayMs: 0,
    async run({
      taskId,
      sourceStorageId,
      fileAction,
    } = {}, taskRuntime = {}) {
      const normalizedAction = normalizeStorageDeleteFileAction(fileAction);
      const task = getTaskLogById(db, taskId);
      const total = countFilesByStorageInstance(db, sourceStorageId);
      const stats = {
        total,
        success: Number(task?.success_count || 0),
        failed: Number(task?.failed_count || 0),
        skipped: Number(task?.skipped_count || 0),
        errors: [],
      };

      startTaskLog(db, taskId);
      updateTaskLogTotals(db, taskId, { totalCount: total });
      logger.info?.({ taskId, sourceStorageId, fileAction: normalizedAction, total }, '删除渠道文件处理任务开始');

      let afterId = null;
      try {
        while (true) {
          taskRuntime.throwIfStopRequested?.();
          const files = listFilesByStorageInstanceAfter(db, {
            storageInstanceId: sourceStorageId,
            afterId,
            limit: batchSize,
          });

          if (files.length === 0) {
            break;
          }

          await taskRuntime.processItems(files, async (file) => processFile(file, {
            taskId,
            sourceStorageId,
            fileAction: normalizedAction,
          }), {
            onResult: async (result, file) => {
              if (result.status === 'success') {
                stats.success += 1;
              } else if (result.status === 'skipped') {
                stats.skipped += 1;
              } else {
                stats.failed += 1;
                stats.errors.push({ id: file.id, reason: result.reason || '处理失败' });
              }

              updateTaskLogTotals(db, taskId, {
                successCount: stats.success,
                failedCount: stats.failed,
                skippedCount: stats.skipped,
                errorSummary: buildErrorSummary(stats.errors, 5),
              });
            },
          });

          afterId = files[files.length - 1].id;
        }
      } catch (error) {
        if (error instanceof TaskStopError) {
          const stopped = stopFromRuntime(taskId, taskRuntime);
          logger.info?.({ taskId, stats, status: stopped?.status }, '删除渠道文件处理任务已停止');
          return {
            ...stats,
            status: stopped?.status || error.status,
            reason: stopped?.reason || error.message,
          };
        }
        throw error;
      }

      const stopped = stopFromRuntime(taskId, taskRuntime);
      if (stopped) {
        logger.info?.({ taskId, stats, status: stopped.status }, '删除渠道文件处理任务已停止');
        return {
          ...stats,
          status: stopped.status,
          reason: stopped.reason,
        };
      }

      const status = buildTaskResultStatus(stats);
      finishTaskLog(db, taskId, {
        status,
        successCount: stats.success,
        failedCount: stats.failed,
        skippedCount: stats.skipped,
        errorSummary: buildErrorSummary(stats.errors),
      });

      if (normalizedAction === 'freeze' && typeof storageManager?.rebuildQuotaStats === 'function') {
        await storageManager.rebuildQuotaStats();
      }

      invalidateFilesCache();
      invalidateStorageCaches();
      invalidateDashboardCaches();

      logger.info?.({ taskId, stats, status }, '删除渠道文件处理任务结束');
      return stats;
    },
  };
}

function createStorageDeleteFilesTaskService({
  db,
  storageManager,
  logger = createLogger('tasks'),
  taskExecutor = defaultMaintenanceTaskExecutor,
  deleteFileRecord = defaultDeleteFileRecord,
  applyPendingQuotaEvents = storageManager?.applyPendingQuotaEvents,
  invalidateFilesCache = () => {},
  invalidateStorageCaches = () => {},
  invalidateDashboardCaches = () => {},
  taskDefinition = null,
} = {}) {
  const definition = taskDefinition || createStorageDeleteFilesTaskDefinition({
    db,
    storageManager,
    logger,
    deleteFileRecord,
    applyPendingQuotaEvents,
    invalidateFilesCache,
    invalidateStorageCaches,
    invalidateDashboardCaches,
  });

  taskExecutor.registerTask(definition);

  return {
    assertCanStartStorageDeleteFilesTask({
      sourceStorageId,
      fileAction,
    } = {}) {
      const normalizedAction = normalizeStorageDeleteFileAction(fileAction);
      if (!sourceStorageId) {
        throw new ValidationError('源渠道不能为空');
      }

      assertNoRunningStorageDeleteFiles(taskExecutor);
      return normalizedAction;
    },

    startStorageDeleteFilesTask({
      sourceStorageId,
      fileAction,
    } = {}) {
      const normalizedAction = this.assertCanStartStorageDeleteFilesTask({
        sourceStorageId,
        fileAction,
      });

      const total = countActiveFilesByStorageInstance(db, sourceStorageId);
      const taskId = createTaskLog(db, {
        taskType: STORAGE_DELETE_FILES_TASK_TYPE,
        triggerType: 'automatic',
        sourceStorageId,
        targetStorageId: null,
        totalCount: total,
      });

      taskExecutor.start(STORAGE_DELETE_FILES_TASK_NAME, {
        taskId,
        sourceStorageId,
        fileAction: normalizedAction,
      });

      return {
        taskId,
        status: 'processing',
        fileAction: normalizedAction,
      };
    },

    cancelStorageDeleteFilesTask(taskId, {
      reason = null,
    } = {}) {
      const task = getTaskLogById(db, taskId);
      if (!task) {
        throw new ValidationError('任务日志不存在');
      }
      if (task.task_type !== STORAGE_DELETE_FILES_TASK_TYPE) {
        throw new ValidationError('仅支持取消删除渠道文件处理任务');
      }
      if (task.status !== 'pending' && task.status !== 'running') {
        throw new ConflictError('任务当前状态不支持取消', 'TASK_CANCEL_NOT_ALLOWED');
      }

      const finalReason = reason || STORAGE_DELETE_FILES_STOP_MESSAGES.cancel;
      if (typeof taskExecutor.requestStop === 'function') {
        taskExecutor.requestStop(STORAGE_DELETE_FILES_TASK_NAME, {
          action: 'cancel',
          reason: finalReason,
        });
      }
      stopTaskLog(db, taskId, {
        status: 'cancelled',
        reason: finalReason,
      });
      markActiveTaskItemsStopped(db, taskId, {
        status: 'cancelled',
        reason: finalReason,
      });

      return {
        taskId,
        status: 'cancelled',
      };
    },
  };
}

export {
  STORAGE_DELETE_FILES_TASK_NAME,
  STORAGE_DELETE_FILES_TASK_TYPE,
  normalizeStorageDeleteFileAction,
  createStorageDeleteFilesTaskDefinition,
  createStorageDeleteFilesTaskService,
};
