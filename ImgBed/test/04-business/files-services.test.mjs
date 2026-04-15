import assert from 'node:assert/strict';
import test from 'node:test';

import { insertDirectory } from '../../src/database/directories-dao.js';
import { getFileById, insertFile } from '../../src/database/files-dao.js';
import { NotFoundError, ValidationError } from '../../src/errors/AppError.js';
import { createFileUpdateService } from '../../src/services/files/file-update-service.js';
import { createFilesMaintenanceService } from '../../src/services/files/files-maintenance-service.js';
import { createFilesQueryService } from '../../src/services/files/files-query-service.js';
import { serializeStorageMeta } from '../../src/utils/storage-meta.js';
import { createLoggerDouble } from '../helpers/runtime-test-helpers.mjs';
import { createTestDb } from '../helpers/storage-test-helpers.mjs';

function buildFileRecord(overrides = {}) {
  return {
    id: overrides.id || 'file-1',
    file_name: overrides.file_name || 'demo.png',
    original_name: overrides.original_name || 'origin-demo.png',
    mime_type: overrides.mime_type || 'image/png',
    size: overrides.size ?? 123,
    storage_channel: overrides.storage_channel || 'local',
    storage_key: overrides.storage_key || 'storage-key',
    storage_meta: overrides.storage_meta ?? serializeStorageMeta({ deleteToken: { messageId: '1' } }),
    storage_instance_id: overrides.storage_instance_id || 'storage-1',
    upload_ip: overrides.upload_ip || '127.0.0.1',
    upload_address: overrides.upload_address || '{}',
    uploader_type: overrides.uploader_type || 'admin',
    uploader_id: overrides.uploader_id || 'admin',
    directory: overrides.directory || '/',
    tags: overrides.tags ?? null,
    is_public: overrides.is_public ?? 1,
    is_chunked: overrides.is_chunked ?? 0,
    chunk_count: overrides.chunk_count ?? 0,
    width: overrides.width === undefined ? 100 : overrides.width,
    height: overrides.height === undefined ? 200 : overrides.height,
    exif: overrides.exif ?? null,
    status: overrides.status || 'active',
  };
}

test('createFilesQueryService 会处理浏览、搜索与详情读取边界', () => {
  const db = createTestDb();
  try {
    insertDirectory(db, {
      name: '图库',
      path: '/gallery',
      parentId: null,
    });

    insertFile(db, buildFileRecord({
      id: 'file-1',
      file_name: 'cover.png',
      directory: '/gallery',
    }));
    insertFile(db, buildFileRecord({
      id: 'file-2',
      file_name: 'banner.png',
      directory: '/gallery',
    }));
    insertFile(db, buildFileRecord({
      id: 'file-3',
      file_name: 'search-only.png',
      directory: '/outside',
    }));

    const service = createFilesQueryService({ db });
    const browseResult = service.listFiles({
      page: '1',
      pageSize: '1',
      directory: '/gallery',
    });
    const searchResult = service.listFiles({
      search: 'search-only',
    });
    const detail = service.getFileDetail('file-1');

    assert.equal(browseResult.list.length, 1);
    assert.equal(browseResult.pagination.total, 2);
    assert.equal(browseResult.pagination.totalPages, 2);
    assert.equal(searchResult.list.length, 1);
    assert.equal(searchResult.list[0].id, 'file-3');
    assert.equal(detail.file_name, 'cover.png');

    assert.throws(
      () => service.listFiles({ page: '0', directory: '/gallery' }),
      (error) => {
        assert.equal(error instanceof ValidationError, true);
        assert.equal(error.message, 'page 参数必须是大于等于 1 的整数');
        return true;
      },
    );

    assert.throws(
      () => service.listFiles({ directory: '/missing' }),
      (error) => {
        assert.equal(error instanceof ValidationError, true);
        assert.equal(error.message, 'directory 参数不合法：目录不存在：/missing');
        return true;
      },
    );

    assert.throws(
      () => service.getFileDetail('missing'),
      (error) => {
        assert.equal(error instanceof NotFoundError, true);
        assert.equal(error.message, '指定的文件未找到');
        return true;
      },
    );
  } finally {
    db.close();
  }
});

test('createFileUpdateService 会归一化可编辑字段并处理未变更与不存在', () => {
  const db = createTestDb();
  try {
    insertDirectory(db, {
      name: '图库',
      path: '/gallery',
      parentId: null,
    });
    insertDirectory(db, {
      name: '相册',
      path: '/albums',
      parentId: null,
    });
    insertFile(db, buildFileRecord({
      id: 'file-1',
      directory: '/gallery',
      is_public: 1,
    }));

    const service = createFileUpdateService({ db });
    const updated = service.updateFile('file-1', {
      file_name: 'renamed.png',
      directory: 'albums/',
      is_public: 0,
    });
    const stored = getFileById(db, 'file-1');

    assert.deepEqual(updated, {
      id: 'file-1',
      file_name: 'renamed.png',
      directory: '/albums',
      is_public: 0,
    });
    assert.equal(stored.file_name, 'renamed.png');
    assert.equal(stored.directory, '/albums');
    assert.equal(stored.is_public, 0);

    assert.throws(
      () => service.updateFile('file-1', {}),
      (error) => {
        assert.equal(error instanceof ValidationError, true);
        assert.equal(error.message, '未检测到任何需要变更的可更新字段');
        return true;
      },
    );

    assert.throws(
      () => service.updateFile('missing', { file_name: 'missing.png' }),
      (error) => {
        assert.equal(error instanceof NotFoundError, true);
        assert.equal(error.message, '指定文件不存在或其值未发生变动');
        return true;
      },
    );
  } finally {
    db.close();
  }
});

test('createFilesMaintenanceService 会返回 processing 并在后台任务中透传运行时依赖', async () => {
  const { logger } = createLoggerDouble();
  const taskCalls = [];
  const service = createFilesMaintenanceService({
    db: 'mock-db',
    storageManager: 'mock-storage-manager',
    logger,
    rebuildMetadataTaskFn: async (args) => {
      taskCalls.push(args);
    },
  });

  const result = service.startMetadataRebuild({
    force: 'true',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(result, { status: 'processing' });
  assert.deepEqual(taskCalls, [{
    force: true,
    db: 'mock-db',
    storageManager: 'mock-storage-manager',
    logger,
  }]);
});
