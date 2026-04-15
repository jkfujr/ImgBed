import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { updateActiveFileFields } from '../../database/files-dao.js';
import {
  ensureExistingDirectoryPath,
  normalizeDirectoryPath,
} from '../../utils/directory-path.js';

function createFileUpdateService({
  db,
} = {}) {
  function normalizeDirectoryOrThrow(input, fieldLabel = 'directory') {
    try {
      return normalizeDirectoryPath(input);
    } catch (error) {
      throw new ValidationError(`${fieldLabel} 参数不合法：${error.message}`);
    }
  }

  function ensureDirectoryExistsOrThrow(directory, fieldLabel = 'directory') {
    try {
      ensureExistingDirectoryPath(directory, db);
    } catch (error) {
      throw new ValidationError(`${fieldLabel} 参数不合法：${error.message}`);
    }
  }

  return {
    updateFile(id, body = {}) {
      const updateData = {};

      if (body.file_name) {
        updateData.file_name = body.file_name;
      }

      if (body.directory !== undefined) {
        const normalizedDirectory = normalizeDirectoryOrThrow(body.directory);
        ensureDirectoryExistsOrThrow(normalizedDirectory);
        updateData.directory = normalizedDirectory;
      }

      if (body.is_public !== undefined) {
        updateData.is_public = body.is_public ? 1 : 0;
      }

      if (Object.keys(updateData).length === 0) {
        throw new ValidationError('未检测到任何需要变更的可更新字段');
      }

      const result = updateActiveFileFields(db, id, updateData);
      if (!result.changes) {
        throw new NotFoundError('指定文件不存在或其值未发生变动');
      }

      return {
        id,
        ...updateData,
      };
    },
  };
}

export {
  createFileUpdateService,
};
