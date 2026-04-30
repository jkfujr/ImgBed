import { createLogger } from '../../utils/logger.js';
import { ConflictError, ValidationError } from '../../errors/AppError.js';
import {
  countActiveFilesByStorageInstance,
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
import { createFileMigrationService, validateMigrationTarget } from '../files/migrate-file.js';
import { defaultMaintenanceTaskExecutor } from '../maintenance/default-maintenance-task-executor.js';
import { TaskStopError } from '../maintenance/maintenance-task-executor.js';

const CHANNEL_MIGRATION_TASK_NAME = 'channel-migration';
const CHANNEL_MIGRATION_TASK_TYPE = 'channel_migration';
const CHANNEL_MIGRATION_BATCH_SIZE = 100;
const CHANNEL_MIGRATION_MAX_ATTEMPTS = 3;
const CHANNEL_MIGRATION_ITEM_TIMEOUT_MS = 5 * 60 * 1000;
const WRITABLE_STORAGE_TYPES = new Set(['local', 's3', 'huggingface']);
const CHANNEL_MIGRATION_STOP_MESSAGES = {
  pause: '用户暂停任务',
  cancel: '用户取消任务',
};

function resolveItemTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : CHANNEL_MIGRATION_ITEM_TIMEOUT_MS;
}

function assertMigrationChannels({
  sourceChannel,
  targetChannel,
  storageManager,
} = {}) {
  if (!sourceChannel) {
    throw new ValidationError('源渠道不能为空');
  }

  if (!targetChannel) {
    throw new ValidationError('迁移操作必须指定 target_channel（目标渠道ID）');
  }

  if (sourceChannel === targetChannel) {
    throw new ValidationError('源渠道和目标渠道不能相同');
  }

  const sourceEntry = storageManager.getStorageMeta(sourceChannel);
  if (!sourceEntry) {
    throw new ValidationError(`源渠道不存在: ${sourceChannel}`);
  }

  const targetEntry = validateMigrationTarget(targetChannel, storageManager);
  if (!WRITABLE_STORAGE_TYPES.has(targetEntry.type)) {
    throw new ValidationError(`目标渠道类型 ${targetEntry.type} 不支持作为迁移目标`);
  }

  return { sourceEntry, targetEntry };
}

function createChannelMigrationTaskDefinition({
  db,
  storageManager,
  logger = createLogger('tasks'),
  fileMigrationService = null,
  applyPendingQuotaEvents = null,
  countFilesByStorageInstance = countActiveFilesByStorageInstance,
  listFilesByStorageInstanceAfter = listActiveFilesByStorageInstanceAfter,
  invalidateFilesCache = () => {},
  invalidateStorageCaches = () => {},
  invalidateDashboardCaches = () => {},
  batchSize = CHANNEL_MIGRATION_BATCH_SIZE,
  maxAttempts = CHANNEL_MIGRATION_MAX_ATTEMPTS,
  itemTimeoutMs = CHANNEL_MIGRATION_ITEM_TIMEOUT_MS,
} = {}) {
  const resolvedItemTimeoutMs = resolveItemTimeoutMs(itemTimeoutMs);
  const migrationService = fileMigrationService || createFileMigrationService({
    db,
    storageManager,
    applyPendingQuotaEvents,
  });

  async function processFile(file, {
    taskId,
    targetChannel,
    targetEntry,
    taskRuntime,
  }) {
    taskRuntime.throwIfStopRequested?.();
    const itemId = insertTaskLogItem(db, {
      taskId,
      fileId: file.id,
      status: 'running',
    });

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      taskRuntime.throwIfStopRequested?.();
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort(new Error(`文件 ${file.id} 迁移超时`));
      }, resolvedItemTimeoutMs);
      const removeAbortHandler = taskRuntime.addAbortHandler?.((reason) => {
        abortController.abort(new TaskStopError(
          taskRuntime.getStopRequest?.()?.action || 'pause',
          reason || '任务已停止',
        ));
      }) || (() => {});

      try {
        const result = await migrationService.migrateFileRecord(file, {
          targetChannel,
          targetEntry,
          preserveSource: true,
          signal: abortController.signal,
        });

        if (result.status === 'success') {
          updateTaskLogItem(db, itemId, {
            status: 'success',
            attemptCount: attempt,
          });
          return { status: 'success' };
        }

        if (result.status === 'skipped') {
          updateTaskLogItem(db, itemId, {
            status: 'skipped',
            attemptCount: attempt,
          });
          return { status: 'skipped' };
        }

        lastError = new Error(result.reason || '迁移失败');
      } catch (error) {
        if (error instanceof TaskStopError) {
          throw error;
        }
        lastError = error;
      } finally {
        clearTimeout(timeout);
        removeAbortHandler();
      }

      updateTaskLogItem(db, itemId, {
        status: attempt >= maxAttempts ? 'failed' : 'retrying',
        attemptCount: attempt,
        lastError: lastError?.message || String(lastError),
      });
    }

    return {
      status: 'failed',
      reason: lastError?.message || String(lastError || '迁移失败'),
    };
  }

  function stopFromRuntime(taskId, taskRuntime) {
    const stopRequest = taskRuntime.getStopRequest?.();
    if (!stopRequest) {
      return null;
    }

    const reason = stopRequest.reason || CHANNEL_MIGRATION_STOP_MESSAGES[stopRequest.action] || '任务已停止';
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
    name: CHANNEL_MIGRATION_TASK_NAME,
    concurrency: 2,
    itemDelayMs: 0,
    async run({
      taskId,
      sourceChannel,
      targetChannel,
    } = {}, taskRuntime = {}) {
      assertMigrationChannels({ sourceChannel, targetChannel, storageManager });
      const targetEntry = validateMigrationTarget(targetChannel, storageManager);
      const total = countFilesByStorageInstance(db, sourceChannel);
      const stats = {
        total,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [],
      };

      startTaskLog(db, taskId);
      updateTaskLogTotals(db, taskId, { totalCount: total });
      logger.info?.({ taskId, sourceChannel, targetChannel, total }, '渠道迁移任务开始');

      let afterId = null;
      try {
        while (true) {
          taskRuntime.throwIfStopRequested?.();
          const files = listFilesByStorageInstanceAfter(db, {
            storageInstanceId: sourceChannel,
            afterId,
            limit: batchSize,
          });

          if (files.length === 0) {
            break;
          }

          await taskRuntime.processItems(files, async (file) => processFile(file, {
            taskId,
            targetChannel,
            targetEntry,
            taskRuntime,
          }), {
            onResult: async (result, file) => {
              if (result.status === 'success') {
                stats.success += 1;
              } else if (result.status === 'skipped') {
                stats.skipped += 1;
              } else {
                stats.failed += 1;
                stats.errors.push({ id: file.id, reason: result.reason || '迁移失败' });
              }

              updateTaskLogTotals(db, taskId, {
                successCount: stats.success,
                failedCount: stats.failed,
                skippedCount: stats.skipped,
                errorSummary: stats.errors.slice(0, 5).map((item) => `${item.id}: ${item.reason}`).join('\n') || null,
              });
            },
          });

          afterId = files[files.length - 1].id;
        }
      } catch (error) {
        const stopped = stopFromRuntime(taskId, taskRuntime);
        if (stopped) {
          logger.info?.({ taskId, stats, status: stopped.status }, '渠道迁移任务已停止');
          return {
            ...stats,
            status: stopped.status,
            reason: stopped.reason,
          };
        }
        throw error;
      }

      const stopped = stopFromRuntime(taskId, taskRuntime);
      if (stopped) {
        logger.info?.({ taskId, stats, status: stopped.status }, '渠道迁移任务已停止');
        return {
          ...stats,
          status: stopped.status,
          reason: stopped.reason,
        };
      }

      const status = stats.failed > 0
        ? (stats.success > 0 || stats.skipped > 0 ? 'partial_failed' : 'failed')
        : 'completed';
      const errorSummary = stats.errors.slice(0, 10).map((item) => `${item.id}: ${item.reason}`).join('\n') || null;

      finishTaskLog(db, taskId, {
        status,
        successCount: stats.success,
        failedCount: stats.failed,
        skippedCount: stats.skipped,
        errorSummary,
      });
      invalidateFilesCache();
      invalidateStorageCaches();
      invalidateDashboardCaches();

      logger.info?.({ taskId, stats, status }, '渠道迁移任务结束');
      return stats;
    },
  };
}

function createChannelMigrationTaskService({
  db,
  storageManager,
  logger = createLogger('tasks'),
  taskExecutor = defaultMaintenanceTaskExecutor,
  applyPendingQuotaEvents = null,
  invalidateFilesCache = () => {},
  invalidateStorageCaches = () => {},
  invalidateDashboardCaches = () => {},
  taskDefinition = null,
} = {}) {
  const definition = taskDefinition || createChannelMigrationTaskDefinition({
    db,
    storageManager,
    logger,
    applyPendingQuotaEvents,
    invalidateFilesCache,
    invalidateStorageCaches,
    invalidateDashboardCaches,
  });

  taskExecutor.registerTask(definition);

  return {
    startChannelMigration({
      sourceChannel,
      targetChannel,
    } = {}) {
      assertMigrationChannels({ sourceChannel, targetChannel, storageManager });
      const currentSnapshot = typeof taskExecutor.getSnapshot === 'function'
        ? taskExecutor.getSnapshot(CHANNEL_MIGRATION_TASK_NAME)
        : null;
      if (currentSnapshot?.runId && !currentSnapshot?.endedAt) {
        throw new ConflictError('已有渠道迁移任务正在运行，请稍后再试', 'CHANNEL_MIGRATION_RUNNING');
      }

      const total = countActiveFilesByStorageInstance(db, sourceChannel);
      const taskId = createTaskLog(db, {
        taskType: CHANNEL_MIGRATION_TASK_TYPE,
        sourceStorageId: sourceChannel,
        targetStorageId: targetChannel,
        totalCount: total,
      });

      taskExecutor.start(CHANNEL_MIGRATION_TASK_NAME, {
        taskId,
        sourceChannel,
        targetChannel,
      });

      return {
        taskId,
        status: 'processing',
      };
    },

    stopChannelMigration(taskId, {
      action,
      reason = null,
    } = {}) {
      if (action !== 'pause' && action !== 'cancel') {
        throw new ValidationError('不支持的任务操作');
      }

      const task = getTaskLogById(db, taskId);
      if (!task) {
        throw new ValidationError('任务日志不存在');
      }
      if (task.task_type !== CHANNEL_MIGRATION_TASK_TYPE) {
        throw new ValidationError('仅支持操作渠道迁移任务');
      }
      if (task.status !== 'pending' && task.status !== 'running') {
        throw new ConflictError('任务当前状态不支持该操作', 'TASK_NOT_RUNNING');
      }

      const status = action === 'cancel' ? 'cancelled' : 'paused';
      const finalReason = reason || CHANNEL_MIGRATION_STOP_MESSAGES[action];
      if (typeof taskExecutor.requestStop === 'function') {
        taskExecutor.requestStop(CHANNEL_MIGRATION_TASK_NAME, {
          action,
          reason: finalReason,
        });
      }
      stopTaskLog(db, taskId, {
        status,
        reason: finalReason,
      });
      markActiveTaskItemsStopped(db, taskId, {
        status,
        reason: finalReason,
      });

      return {
        taskId,
        status,
      };
    },

    retryChannelMigration(taskId) {
      const task = getTaskLogById(db, taskId);
      if (!task) {
        throw new ValidationError('任务日志不存在');
      }
      if (task.task_type !== CHANNEL_MIGRATION_TASK_TYPE) {
        throw new ValidationError('仅支持重试渠道迁移任务');
      }
      if (!['failed', 'partial_failed', 'paused', 'cancelled'].includes(task.status)) {
        throw new ConflictError('任务当前状态不支持重试', 'TASK_RETRY_NOT_ALLOWED');
      }

      return this.startChannelMigration({
        sourceChannel: task.source_storage_id,
        targetChannel: task.target_storage_id,
      });
    },
  };
}

export {
  CHANNEL_MIGRATION_MAX_ATTEMPTS,
  CHANNEL_MIGRATION_ITEM_TIMEOUT_MS,
  CHANNEL_MIGRATION_TASK_NAME,
  CHANNEL_MIGRATION_TASK_TYPE,
  assertMigrationChannels,
  createChannelMigrationTaskDefinition,
  createChannelMigrationTaskService,
};
