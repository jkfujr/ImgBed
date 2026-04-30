import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import {
  countTaskLogItems,
  countTaskLogs,
  deleteTerminalTaskLogs,
  getTaskLogById,
  listTaskLogItems,
  listTaskLogs,
} from '../../database/task-logs-dao.js';
import { CHANNEL_MIGRATION_TASK_TYPE } from './channel-migration-task.js';
import { STORAGE_DELETE_FILES_TASK_TYPE } from './storage-delete-files-task.js';

function parsePositiveInteger(value, fallbackValue, maxValue = 500) {
  const parsed = Number.parseInt(value ?? fallbackValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError('分页参数必须是大于等于 1 的整数');
  }
  return Math.min(parsed, maxValue);
}

function createTaskLogService({
  db,
  channelMigrationTaskService = null,
  storageDeleteFilesTaskService = null,
} = {}) {
  if (!db) {
    throw new Error('创建任务日志服务时缺少数据库实例');
  }

  function requireChannelMigrationTaskService() {
    if (!channelMigrationTaskService) {
      throw new Error('任务日志服务缺少渠道迁移任务服务');
    }
    return channelMigrationTaskService;
  }

  function requireStorageDeleteFilesTaskService() {
    if (!storageDeleteFilesTaskService) {
      throw new Error('任务日志服务缺少删除渠道文件处理任务服务');
    }
    return storageDeleteFilesTaskService;
  }

  return {
    listTasks({
      page = '1',
      pageSize = '20',
      status = '',
      taskType = '',
    } = {}) {
      const parsedPage = parsePositiveInteger(page, '1', 10000);
      const parsedPageSize = parsePositiveInteger(pageSize, '20', 100);
      const query = {
        status: status || null,
        taskType: taskType || null,
      };
      const offset = (parsedPage - 1) * parsedPageSize;
      const list = listTaskLogs(db, {
        ...query,
        limit: parsedPageSize,
        offset,
      });
      const total = countTaskLogs(db, query);

      return {
        list,
        pagination: {
          page: parsedPage,
          pageSize: parsedPageSize,
          total,
          totalPages: Math.ceil(total / parsedPageSize),
        },
      };
    },

    getTaskDetail(taskId, {
      itemStatus = '',
      page = '1',
      pageSize = '200',
    } = {}) {
      const task = getTaskLogById(db, taskId);
      if (!task) {
        throw new NotFoundError('任务日志不存在');
      }

      const parsedPage = parsePositiveInteger(page, '1', 10000);
      const parsedPageSize = parsePositiveInteger(pageSize, '200', 500);
      const itemQuery = {
        status: itemStatus || null,
      };
      const offset = (parsedPage - 1) * parsedPageSize;
      const items = listTaskLogItems(db, taskId, {
        ...itemQuery,
        limit: parsedPageSize,
        offset,
      });
      const total = countTaskLogItems(db, taskId, itemQuery);

      return {
        task,
        items,
        pagination: {
          page: parsedPage,
          pageSize: parsedPageSize,
          total,
          totalPages: Math.ceil(total / parsedPageSize),
        },
      };
    },

    clearTerminalTasks() {
      const result = deleteTerminalTaskLogs(db);
      return {
        deleted: Number(result?.changes || 0),
      };
    },

    pauseTask(taskId) {
      return requireChannelMigrationTaskService().stopChannelMigration(taskId, {
        action: 'pause',
      });
    },

    cancelTask(taskId) {
      const task = getTaskLogById(db, taskId);
      if (!task) {
        throw new NotFoundError('任务日志不存在');
      }

      if (task.task_type === CHANNEL_MIGRATION_TASK_TYPE) {
        return requireChannelMigrationTaskService().stopChannelMigration(taskId, {
          action: 'cancel',
        });
      }

      if (task.task_type === STORAGE_DELETE_FILES_TASK_TYPE) {
        return requireStorageDeleteFilesTaskService().cancelStorageDeleteFilesTask(taskId);
      }

      throw new ValidationError('不支持取消该任务类型');
    },

    resumeTask(taskId) {
      return requireChannelMigrationTaskService().resumeChannelMigration(taskId);
    },

    retryTask(taskId) {
      return requireChannelMigrationTaskService().retryChannelMigration(taskId);
    },
  };
}

export {
  createTaskLogService,
};
