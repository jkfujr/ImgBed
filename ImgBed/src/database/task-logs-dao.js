import crypto from 'crypto';

const ACTIVE_TASK_STATUSES = new Set(['pending', 'running']);
const ACTIVE_TASK_ITEM_STATUSES = new Set(['pending', 'running', 'retrying']);
const STOP_TASK_STATUSES = new Set(['paused', 'cancelled']);
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'partial_failed', 'paused', 'cancelled']);

function buildPlaceholders(values) {
  return Array.from(values).map(() => '?').join(', ');
}

function assertTerminalTaskStatus(status) {
  if (!TERMINAL_TASK_STATUSES.has(status)) {
    throw new Error(`不支持的任务终态: ${status}`);
  }
}

function assertStopTaskStatus(status) {
  if (!STOP_TASK_STATUSES.has(status)) {
    throw new Error(`不支持的任务停止状态: ${status}`);
  }
}

function createTaskLog(db, {
  taskType,
  sourceStorageId = null,
  targetStorageId = null,
  totalCount = 0,
} = {}) {
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO task_logs (
      id, task_type, status, source_storage_id, target_storage_id, total_count
    ) VALUES (
      @id, @task_type, @status, @source_storage_id, @target_storage_id, @total_count
    )
  `).run({
    id,
    task_type: taskType,
    status: 'pending',
    source_storage_id: sourceStorageId,
    target_storage_id: targetStorageId,
    total_count: Number(totalCount) || 0,
  });

  return id;
}

function startTaskLog(db, taskId) {
  return db.prepare(`
    UPDATE task_logs
    SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND status = 'pending'
  `).run(taskId);
}

function updateTaskLogTotals(db, taskId, totals = {}) {
  return db.prepare(`
    UPDATE task_logs SET
      total_count = COALESCE(@total_count, total_count),
      success_count = COALESCE(@success_count, success_count),
      failed_count = COALESCE(@failed_count, failed_count),
      skipped_count = COALESCE(@skipped_count, skipped_count),
      error_summary = COALESCE(@error_summary, error_summary)
    WHERE id = @id
      AND status IN ('pending', 'running')
  `).run({
    id: taskId,
    total_count: totals.totalCount ?? null,
    success_count: totals.successCount ?? null,
    failed_count: totals.failedCount ?? null,
    skipped_count: totals.skippedCount ?? null,
    error_summary: totals.errorSummary ?? null,
  });
}

function finishTaskLog(db, taskId, {
  status,
  successCount,
  failedCount,
  skippedCount,
  errorSummary = null,
} = {}) {
  assertTerminalTaskStatus(status);
  return db.prepare(`
    UPDATE task_logs SET
      status = @status,
      success_count = COALESCE(@success_count, success_count),
      failed_count = COALESCE(@failed_count, failed_count),
      skipped_count = COALESCE(@skipped_count, skipped_count),
      error_summary = @error_summary,
      ended_at = CURRENT_TIMESTAMP
    WHERE id = @id
      AND status IN ('pending', 'running')
  `).run({
    id: taskId,
    status,
    success_count: successCount === undefined ? null : Number(successCount) || 0,
    failed_count: failedCount === undefined ? null : Number(failedCount) || 0,
    skipped_count: skippedCount === undefined ? null : Number(skippedCount) || 0,
    error_summary: errorSummary,
  });
}

function stopTaskLog(db, taskId, {
  status,
  reason = null,
} = {}) {
  assertStopTaskStatus(status);
  return finishTaskLog(db, taskId, {
    status,
    errorSummary: reason,
  });
}

function insertTaskLogItem(db, {
  taskId,
  fileId,
  status = 'pending',
  attemptCount = 0,
  lastError = null,
} = {}) {
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO task_log_items (
      id, task_id, file_id, status, attempt_count, last_error
    ) VALUES (
      @id, @task_id, @file_id, @status, @attempt_count, @last_error
    )
  `).run({
    id,
    task_id: taskId,
    file_id: fileId,
    status,
    attempt_count: Number(attemptCount) || 0,
    last_error: lastError,
  });

  return id;
}

function updateTaskLogItem(db, itemId, {
  status,
  attemptCount,
  lastError = null,
} = {}) {
  return db.prepare(`
    UPDATE task_log_items SET
      status = @status,
      attempt_count = @attempt_count,
      last_error = @last_error
    WHERE id = @id
      AND status IN ('pending', 'running', 'retrying')
  `).run({
    id: itemId,
    status,
    attempt_count: Number(attemptCount) || 0,
    last_error: lastError,
  });
}

function markActiveTaskItemsStopped(db, taskId, {
  status,
  reason = null,
} = {}) {
  assertStopTaskStatus(status);
  return db.prepare(`
    UPDATE task_log_items SET
      status = @status,
      last_error = COALESCE(@reason, last_error)
    WHERE task_id = @task_id
      AND status IN ('pending', 'running', 'retrying')
  `).run({
    task_id: taskId,
    status,
    reason,
  });
}

function listTaskLogs(db, {
  status = null,
  taskType = null,
  limit = 50,
  offset = 0,
} = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (taskType) {
    conditions.push('task_type = ?');
    params.push(taskType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT *
    FROM task_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.max(1, Number(limit) || 50), Math.max(0, Number(offset) || 0));
}

function countTaskLogs(db, { status = null, taskType = null } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (taskType) {
    conditions.push('task_type = ?');
    params.push(taskType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = db.prepare(`SELECT COUNT(id) AS total FROM task_logs ${whereClause}`).get(...params);
  return Number(row?.total || 0);
}

function getTaskLogById(db, taskId) {
  return db.prepare('SELECT * FROM task_logs WHERE id = ? LIMIT 1').get(taskId);
}

function listTaskLogItems(db, taskId, {
  status = null,
  limit = 200,
  offset = 0,
} = {}) {
  const conditions = ['task_id = ?'];
  const params = [taskId];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  return db.prepare(`
    SELECT *
    FROM task_log_items
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(...params, Math.max(1, Number(limit) || 200), Math.max(0, Number(offset) || 0));
}

function countTaskLogItems(db, taskId, { status = null } = {}) {
  const conditions = ['task_id = ?'];
  const params = [taskId];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const row = db.prepare(`
    SELECT COUNT(id) AS total
    FROM task_log_items
    WHERE ${conditions.join(' AND ')}
  `).get(...params);
  return Number(row?.total || 0);
}

function deleteTerminalTaskLogs(db) {
  const placeholders = buildPlaceholders(TERMINAL_TASK_STATUSES);
  return db.prepare(`
    DELETE FROM task_logs
    WHERE status IN (${placeholders})
  `).run(...TERMINAL_TASK_STATUSES);
}

export {
  ACTIVE_TASK_STATUSES,
  ACTIVE_TASK_ITEM_STATUSES,
  STOP_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  countTaskLogItems,
  countTaskLogs,
  createTaskLog,
  deleteTerminalTaskLogs,
  finishTaskLog,
  getTaskLogById,
  insertTaskLogItem,
  listTaskLogItems,
  listTaskLogs,
  markActiveTaskItemsStopped,
  startTaskLog,
  stopTaskLog,
  updateTaskLogItem,
  updateTaskLogTotals,
};
