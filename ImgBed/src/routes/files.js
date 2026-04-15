import express from 'express';

import { sqlite } from '../database/index.js';
import { adminAuth, requirePermission } from '../middleware/auth.js';
import storageManager from '../storage/manager.js';
import { applyPendingQuotaEvents as defaultApplyPendingQuotaEvents } from '../storage/runtime/default-storage-runtime.js';
import { createLogger } from '../utils/logger.js';
import { deleteFileRecord } from '../services/files/delete-file.js';
import { executeFilesBatchAction } from '../services/files/batch-action.js';
import { createFilesQueryService } from '../services/files/files-query-service.js';
import { createFileUpdateService } from '../services/files/file-update-service.js';
import { createFilesMaintenanceService } from '../services/files/files-maintenance-service.js';
import { invalidateFilesCache as defaultInvalidateFilesCache } from '../services/cache/cache-invalidation-service.js';
import { filesListCache } from './files/cache.js';
import { createFilesReadRouter } from './files/read-router.js';
import { createFilesMutateRouter } from './files/mutate-router.js';
import { createFilesBatchRouter } from './files/batch-router.js';
import { createFilesMaintenanceRouter } from './files/maintenance-router.js';

function buildFilesDependencies(overrides = {}) {
  const db = overrides.db || sqlite;
  const logger = overrides.logger || createLogger('files');

  const deps = {
    adminAuth: overrides.adminAuth || adminAuth,
    requirePermission: overrides.requirePermission || requirePermission,
    db,
    storageManager: overrides.storageManager || storageManager,
    applyPendingQuotaEvents: overrides.applyPendingQuotaEvents || defaultApplyPendingQuotaEvents,
    deleteFileRecord: overrides.deleteFileRecord || deleteFileRecord,
    executeFilesBatchAction: overrides.executeFilesBatchAction || executeFilesBatchAction,
    filesListCache: overrides.filesListCache || filesListCache,
    invalidateFilesCache: overrides.invalidateFilesCache || defaultInvalidateFilesCache,
    logger,
  };

  deps.filesQueryService = overrides.filesQueryService || createFilesQueryService({
    db: deps.db,
  });
  deps.fileUpdateService = overrides.fileUpdateService || createFileUpdateService({
    db: deps.db,
  });
  deps.filesMaintenanceService = overrides.filesMaintenanceService || createFilesMaintenanceService({
    db: deps.db,
    storageManager: deps.storageManager,
    logger: deps.logger,
  });

  return deps;
}

function createFilesRouter(overrides = {}) {
  const deps = buildFilesDependencies(overrides);
  const router = express.Router();

  router.use(createFilesReadRouter({
    requirePermission: deps.requirePermission,
    filesListCache: deps.filesListCache,
    filesQueryService: deps.filesQueryService,
  }));
  router.use(createFilesMutateRouter({
    adminAuth: deps.adminAuth,
    db: deps.db,
    storageManager: deps.storageManager,
    applyPendingQuotaEvents: deps.applyPendingQuotaEvents,
    filesQueryService: deps.filesQueryService,
    fileUpdateService: deps.fileUpdateService,
    deleteFileRecord: deps.deleteFileRecord,
    invalidateFilesCache: deps.invalidateFilesCache,
  }));
  router.use(createFilesBatchRouter({
    adminAuth: deps.adminAuth,
    db: deps.db,
    storageManager: deps.storageManager,
    executeFilesBatchAction: deps.executeFilesBatchAction,
    invalidateFilesCache: deps.invalidateFilesCache,
  }));
  router.use(createFilesMaintenanceRouter({
    requirePermission: deps.requirePermission,
    filesMaintenanceService: deps.filesMaintenanceService,
  }));

  return router;
}

const filesRouter = createFilesRouter();

export {
  createFilesRouter,
};

export default filesRouter;
