import { ValidationError } from '../../errors/AppError.js';

const STORAGE_DELETE_FILE_ACTIONS = new Set(['freeze', 'delete_records']);

function normalizeStorageDeleteFileAction(fileAction) {
  const normalized = String(fileAction || '').trim().toLowerCase();
  if (!STORAGE_DELETE_FILE_ACTIONS.has(normalized)) {
    throw new ValidationError('file_action 参数必须是 freeze 或 delete_records');
  }
  return normalized;
}

export {
  normalizeStorageDeleteFileAction,
};
