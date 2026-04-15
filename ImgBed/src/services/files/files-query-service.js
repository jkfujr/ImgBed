import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import {
  countActiveFiles,
  getActiveFileById,
  listActiveFiles,
} from '../../database/files-dao.js';
import {
  ensureExistingDirectoryPath,
  parseOptionalDirectoryPath,
} from '../../utils/directory-path.js';

function createFilesQueryService({
  db,
} = {}) {
  function parsePositiveInteger(value, fieldLabel, fallbackValue) {
    const parsed = Number.parseInt(value ?? fallbackValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ValidationError(`${fieldLabel} 参数必须是大于等于 1 的整数`);
    }

    return parsed;
  }

  function parseDirectoryOrThrow(input, fieldLabel = 'directory') {
    try {
      return parseOptionalDirectoryPath(input);
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
    listFiles({
      page = '1',
      pageSize = '20',
      directory,
      search = '',
    } = {}) {
      const parsedPage = parsePositiveInteger(page, 'page', '1');
      const parsedPageSize = parsePositiveInteger(pageSize, 'pageSize', '20');
      const parsedDirectory = parseDirectoryOrThrow(directory);
      const parsedSearch = typeof search === 'string' ? search.trim() : '';

      if (!parsedSearch && parsedDirectory === undefined) {
        throw new ValidationError('浏览文件列表时必须提供 directory 参数');
      }

      if (parsedDirectory !== undefined) {
        ensureDirectoryExistsOrThrow(parsedDirectory);
      }

      const query = {
        directory: parsedDirectory,
        search: parsedSearch,
      };
      const offset = (parsedPage - 1) * parsedPageSize;
      const list = listActiveFiles(db, {
        ...query,
        limit: parsedPageSize,
        offset,
      });
      const total = countActiveFiles(db, query);

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

    getFileDetail(id) {
      const file = getActiveFileById(db, id);
      if (!file) {
        throw new NotFoundError('指定的文件未找到');
      }

      return file;
    },
  };
}

export {
  createFilesQueryService,
};
