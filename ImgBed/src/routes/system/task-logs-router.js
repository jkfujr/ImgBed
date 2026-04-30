import express from 'express';

import asyncHandler from '../../middleware/asyncHandler.js';
import { success } from '../../utils/response.js';

function createSystemTaskLogsRouter({
  taskLogService,
} = {}) {
  const router = express.Router();

  router.get('/task-logs', asyncHandler(async (req, res) => {
    return res.json(success(taskLogService.listTasks({
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
      taskType: req.query.task_type,
    })));
  }));

  router.get('/task-logs/:id', asyncHandler(async (req, res) => {
    return res.json(success(taskLogService.getTaskDetail(req.params.id, {
      itemStatus: req.query.item_status,
      page: req.query.page,
      pageSize: req.query.pageSize,
    })));
  }));

  router.delete('/task-logs', asyncHandler(async (_req, res) => {
    return res.json(success(taskLogService.clearTerminalTasks(), '终态任务日志已清理'));
  }));

  return router;
}

export {
  createSystemTaskLogsRouter,
};
