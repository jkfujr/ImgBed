import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import {
  createTempAppRoot,
  resolveProjectModuleUrl,
} from '../helpers/runtime-test-helpers.mjs';

const appRoot = createTempAppRoot('imgbed-03-files-router-');
process.env.IMGBED_APP_ROOT = appRoot;

const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
configModule.loadStartupConfig();

const { NotFoundError, ValidationError } = await import(resolveProjectModuleUrl('src', 'errors', 'AppError.js'));
const { notFoundHandler, registerErrorHandlers } = await import(resolveProjectModuleUrl('src', 'middleware', 'errorHandler.js'));
const { createFilesRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'files.js'));
const { createFilesReadRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'files', 'read-router.js'));
const { createFilesMutateRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'files', 'mutate-router.js'));
const { createFilesBatchRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'files', 'batch-router.js'));
const { createFilesMaintenanceRouter } = await import(resolveProjectModuleUrl('src', 'routes', 'files', 'maintenance-router.js'));

function createPassthroughCache() {
  return () => (_req, _res, next) => next();
}

function createPermissionRecorder(calls) {
  return (permission) => (req, _res, next) => {
    calls.push({
      kind: 'permission',
      permission,
      method: req.method,
      path: req.path,
    });
    next();
  };
}

function createAdminAuthRecorder(calls) {
  return (req, _res, next) => {
    calls.push({
      kind: 'admin',
      method: req.method,
      path: req.path,
    });
    next();
  };
}

async function startRouterApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(notFoundHandler);
  registerErrorHandlers(app);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function requestJson(appHandle, path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  let body = options.body;

  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  const response = await fetch(appHandle.baseUrl + path, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('createFilesRouter 会使用注入依赖完成装配，而不是直接依赖全局实现', async (t) => {
  const authCalls = [];
  const serviceCalls = [];
  const invalidateCalls = [];
  const passthroughCache = createPassthroughCache();

  const appHandle = await startRouterApp(createFilesRouter({
    db: 'mock-db',
    storageManager: 'mock-storage-manager',
    applyPendingQuotaEvents: 'mock-apply-pending-quota',
    requirePermission: createPermissionRecorder(authCalls),
    adminAuth: createAdminAuthRecorder(authCalls),
    filesListCache: passthroughCache,
    filesQueryService: {
      listFiles(args) {
        serviceCalls.push({ type: 'listFiles', args });
        return {
          list: [{ id: 'file-1', file_name: 'demo.png' }],
          pagination: {
            page: 2,
            pageSize: 5,
            total: 1,
            totalPages: 1,
          },
        };
      },
      getFileDetail(id) {
        serviceCalls.push({ type: 'getFileDetail', id });
        return { id, file_name: 'demo.png' };
      },
    },
    fileUpdateService: {
      updateFile(id, body) {
        serviceCalls.push({ type: 'updateFile', id, body });
        return { id, file_name: body.file_name };
      },
    },
    deleteFileRecord: async (fileRecord, options) => {
      serviceCalls.push({
        type: 'deleteFileRecord',
        fileRecord,
        deleteMode: options.deleteMode,
        db: options.db,
        storageManager: options.storageManager,
        applyPendingQuotaEvents: options.applyPendingQuotaEvents,
      });
    },
    executeFilesBatchAction: async (payload) => {
      serviceCalls.push({ type: 'executeFilesBatchAction', payload });
      return {
        code: 0,
        message: '批处理执行成功',
        data: { action: payload.action, ids: payload.ids },
      };
    },
    filesMaintenanceService: {
      startMetadataRebuild(args) {
        serviceCalls.push({ type: 'startMetadataRebuild', args });
        return { status: 'processing' };
      },
    },
    invalidateFilesCache: () => {
      invalidateCalls.push('invalidateFilesCache');
    },
  }));
  t.after(() => appHandle.stop());

  const listResponse = await requestJson(appHandle, '/?page=2&pageSize=5&directory=%2Fgallery&search=demo');
  const detailResponse = await requestJson(appHandle, '/file-1');
  const updateResponse = await requestJson(appHandle, '/file-1', {
    method: 'PUT',
    json: { file_name: 'renamed.png' },
  });
  const deleteResponse = await requestJson(appHandle, '/file-1?delete_mode=index_only', {
    method: 'DELETE',
  });
  const batchResponse = await requestJson(appHandle, '/batch', {
    method: 'POST',
    json: {
      action: 'delete',
      ids: ['file-1'],
    },
  });
  const maintenanceResponse = await requestJson(appHandle, '/maintenance/rebuild-metadata?force=true', {
    method: 'POST',
  });

  assert.equal(listResponse.status, 200);
  assert.equal(detailResponse.status, 200);
  assert.equal(updateResponse.status, 200);
  assert.equal(deleteResponse.status, 200);
  assert.equal(batchResponse.status, 200);
  assert.equal(maintenanceResponse.status, 200);
  assert.equal(updateResponse.body.message, '文件信息更新已完成');
  assert.equal(deleteResponse.body.message, '文件删除成功');
  assert.equal(maintenanceResponse.body.message, '元数据重建任务已在后台启动');
  assert.deepEqual(invalidateCalls, [
    'invalidateFilesCache',
    'invalidateFilesCache',
    'invalidateFilesCache',
  ]);
  assert.deepEqual(serviceCalls, [
    {
      type: 'listFiles',
      args: {
        page: '2',
        pageSize: '5',
        directory: '/gallery',
        search: 'demo',
      },
    },
    {
      type: 'getFileDetail',
      id: 'file-1',
    },
    {
      type: 'updateFile',
      id: 'file-1',
      body: { file_name: 'renamed.png' },
    },
    {
      type: 'getFileDetail',
      id: 'file-1',
    },
    {
      type: 'deleteFileRecord',
      fileRecord: { id: 'file-1', file_name: 'demo.png' },
      deleteMode: 'index_only',
      db: 'mock-db',
      storageManager: 'mock-storage-manager',
      applyPendingQuotaEvents: 'mock-apply-pending-quota',
    },
    {
      type: 'executeFilesBatchAction',
      payload: {
        action: 'delete',
        ids: ['file-1'],
        targetDirectory: undefined,
        targetChannel: undefined,
        deleteMode: 'remote_and_index',
        db: 'mock-db',
        storageManager: 'mock-storage-manager',
      },
    },
    {
      type: 'startMetadataRebuild',
      args: {
        force: 'true',
      },
    },
  ]);
  assert.deepEqual(authCalls, [
    { kind: 'permission', permission: 'files:read', method: 'GET', path: '/' },
    { kind: 'permission', permission: 'files:read', method: 'GET', path: '/file-1' },
    { kind: 'admin', method: 'PUT', path: '/file-1' },
    { kind: 'admin', method: 'DELETE', path: '/file-1' },
    { kind: 'admin', method: 'POST', path: '/batch' },
    { kind: 'permission', permission: 'admin', method: 'POST', path: '/maintenance/rebuild-metadata' },
  ]);
});

test('createFilesReadRouter 会保持列表分页、搜索与详情读取契约', async (t) => {
  const permissionCalls = [];
  const serviceCalls = [];
  const passthroughCache = createPassthroughCache();

  const appHandle = await startRouterApp(createFilesReadRouter({
    requirePermission: createPermissionRecorder(permissionCalls),
    filesListCache: passthroughCache,
    filesQueryService: {
      listFiles(args) {
        serviceCalls.push({ type: 'list', args });
        return {
          list: [{ id: 'file-2' }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        };
      },
      getFileDetail(id) {
        serviceCalls.push({ type: 'detail', id });
        return { id, original_name: 'origin.png' };
      },
    },
  }));
  t.after(() => appHandle.stop());

  const listResponse = await requestJson(appHandle, '/?page=1&pageSize=20&search=cover');
  const detailResponse = await requestJson(appHandle, '/file-2');

  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.data.list[0].id, 'file-2');
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.body.data.original_name, 'origin.png');
  assert.deepEqual(serviceCalls, [
    {
      type: 'list',
      args: {
        page: '1',
        pageSize: '20',
        directory: undefined,
        search: 'cover',
      },
    },
    {
      type: 'detail',
      id: 'file-2',
    },
  ]);
  assert.deepEqual(permissionCalls, [
    { kind: 'permission', permission: 'files:read', method: 'GET', path: '/' },
    { kind: 'permission', permission: 'files:read', method: 'GET', path: '/file-2' },
  ]);
});

test('createFilesMutateRouter 会保持更新、删除成功与错误边界', async (t) => {
  const authCalls = [];
  const invalidateCalls = [];
  const appHandle = await startRouterApp(createFilesMutateRouter({
    adminAuth: createAdminAuthRecorder(authCalls),
    db: 'mock-db',
    storageManager: 'mock-storage-manager',
    applyPendingQuotaEvents: 'mock-apply-quota',
    filesQueryService: {
      getFileDetail(id) {
        if (id === 'missing-file') {
          throw new NotFoundError('指定的文件未找到');
        }

        return { id, file_name: 'demo.png' };
      },
    },
    fileUpdateService: {
      updateFile(id, body) {
        if (id === 'unchanged-file') {
          throw new ValidationError('未检测到任何需要变更的可更新字段');
        }

        return { id, directory: body.directory };
      },
    },
    deleteFileRecord: async () => {},
    invalidateFilesCache: () => {
      invalidateCalls.push('invalidate');
    },
  }));
  t.after(() => appHandle.stop());

  const updateResponse = await requestJson(appHandle, '/file-1', {
    method: 'PUT',
    json: { directory: '/albums' },
  });
  const updateErrorResponse = await requestJson(appHandle, '/unchanged-file', {
    method: 'PUT',
    json: {},
  });
  const deleteResponse = await requestJson(appHandle, '/file-1', {
    method: 'DELETE',
  });
  const deleteErrorResponse = await requestJson(appHandle, '/missing-file', {
    method: 'DELETE',
  });

  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.data.directory, '/albums');
  assert.equal(updateErrorResponse.status, 400);
  assert.equal(updateErrorResponse.body.message, '未检测到任何需要变更的可更新字段');
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteErrorResponse.status, 404);
  assert.equal(deleteErrorResponse.body.message, '指定的文件未找到');
  assert.deepEqual(invalidateCalls, ['invalidate', 'invalidate']);
  assert.deepEqual(authCalls, [
    { kind: 'admin', method: 'PUT', path: '/file-1' },
    { kind: 'admin', method: 'PUT', path: '/unchanged-file' },
    { kind: 'admin', method: 'DELETE', path: '/file-1' },
    { kind: 'admin', method: 'DELETE', path: '/missing-file' },
  ]);
});

test('createFilesBatchRouter 会保持批量动作分发契约', async (t) => {
  const authCalls = [];
  const executeCalls = [];
  const invalidateCalls = [];

  const appHandle = await startRouterApp(createFilesBatchRouter({
    adminAuth: createAdminAuthRecorder(authCalls),
    db: 'mock-db',
    storageManager: 'mock-storage-manager',
    executeFilesBatchAction: async (payload) => {
      executeCalls.push(payload);
      return {
        code: 0,
        message: '批处理执行成功',
        data: {
          action: payload.action,
          target_channel: payload.targetChannel,
        },
      };
    },
    invalidateFilesCache: () => {
      invalidateCalls.push('invalidate');
    },
  }));
  t.after(() => appHandle.stop());

  const response = await requestJson(appHandle, '/batch', {
    method: 'POST',
    json: {
      action: 'migrate',
      ids: ['file-1', 'file-2'],
      target_channel: 's3-1',
      delete_mode: 'index_only',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.action, 'migrate');
  assert.equal(response.body.data.target_channel, 's3-1');
  assert.deepEqual(executeCalls, [{
    action: 'migrate',
    ids: ['file-1', 'file-2'],
    targetDirectory: undefined,
    targetChannel: 's3-1',
    deleteMode: 'index_only',
    db: 'mock-db',
    storageManager: 'mock-storage-manager',
  }]);
  assert.deepEqual(invalidateCalls, ['invalidate']);
  assert.deepEqual(authCalls, [
    { kind: 'admin', method: 'POST', path: '/batch' },
  ]);
});

test('createFilesMaintenanceRouter 会返回 processing 并透传后台任务参数', async (t) => {
  const permissionCalls = [];
  const taskCalls = [];

  const appHandle = await startRouterApp(createFilesMaintenanceRouter({
    requirePermission: createPermissionRecorder(permissionCalls),
    filesMaintenanceService: {
      startMetadataRebuild(args) {
        taskCalls.push(args);
        return { status: 'processing' };
      },
    },
  }));
  t.after(() => appHandle.stop());

  const response = await requestJson(appHandle, '/maintenance/rebuild-metadata?force=true', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'processing');
  assert.deepEqual(taskCalls, [{
    force: 'true',
  }]);
  assert.deepEqual(permissionCalls, [
    { kind: 'permission', permission: 'admin', method: 'POST', path: '/maintenance/rebuild-metadata' },
  ]);
});
