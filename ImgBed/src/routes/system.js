import express from 'express';

import { adminAuth } from '../middleware/auth.js';
import storageManager from '../storage/manager.js';
import { sqlite } from '../database/index.js';
import {
  freezeFilesByStorageInstance,
  getActiveFilesStats,
  getTodayUploadCount,
  getUploadTrend,
} from '../database/files-dao.js';
import { readRuntimeConfig, writeRuntimeConfig } from '../config/index.js';
import { applyStorageConfigChange } from '../services/system/apply-storage-config.js';
import { createSystemConfigService } from '../services/system/system-config-service.js';
import { createStorageConfigService } from '../services/system/storage-config-service.js';
import { createMaintenanceService } from '../services/system/maintenance-service.js';
import { createDashboardService } from '../services/system/dashboard-service.js';
import { applySystemConfigUpdates, applyStorageFieldUpdates } from '../services/system/update-config-fields.js';
import { updateLoadBalanceConfig } from '../services/system/update-load-balance.js';
import {
  VALID_STORAGE_TYPES,
  applyStorageConfigPatch,
  buildNewStorageChannel,
  validateStorageChannelInput,
} from '../services/system/create-storage-channel.js';
import { createLogger } from '../utils/logger.js';
import {
  invalidateAllCaches,
  invalidateDashboardCaches,
  invalidateFilesCache,
  invalidateStorageCaches,
  invalidateSystemConfigCache,
} from '../services/cache/cache-invalidation-service.js';
import { getResponseCache } from '../services/cache/response-cache.js';
import { getQuotaEventsArchive } from '../services/archive/quota-events-archive.js';
import { getArchiveScheduler } from '../services/archive/archive-scheduler.js';
import {
  STORAGE_SENSITIVE_KEYS,
  sanitizeStorageChannel,
  sanitizeSystemConfig,
} from '../services/system/sanitize-system-config.js';
import { summarizeStorages } from '../services/system/storage-summary.js';
import {
  dashboardAccessStatsCache,
  dashboardOverviewCache,
  dashboardUploadTrendCache,
  loadBalanceCache,
  quotaStatsCache,
  storagesListCache,
  storagesStatsCache,
  systemConfigCache,
} from './system/cache-factories.js';
import { createSystemConfigRouter } from './system/config-router.js';
import { createSystemStoragesRouter } from './system/storages-router.js';
import { createSystemMaintenanceRouter } from './system/maintenance-router.js';
import { createSystemRuntimeRouter } from './system/runtime-router.js';
import { createSystemDashboardRouter } from './system/dashboard-router.js';

function createFreezeStorageFiles(db) {
  if (typeof db.transaction === 'function') {
    return db.transaction((storageInstanceId) => {
      freezeFilesByStorageInstance(db, storageInstanceId);
    });
  }

  return (storageInstanceId) => {
    freezeFilesByStorageInstance(db, storageInstanceId);
  };
}

function buildSystemDependencies(overrides = {}) {
  const db = overrides.db || sqlite;
  const logger = overrides.logger || createLogger('system');

  const deps = {
    adminAuth: overrides.adminAuth || adminAuth,
    db,
    storageManager: overrides.storageManager || storageManager,
    readRuntimeConfig: overrides.readRuntimeConfig || readRuntimeConfig,
    writeRuntimeConfig: overrides.writeRuntimeConfig || writeRuntimeConfig,
    getResponseCache: overrides.getResponseCache || getResponseCache,
    getQuotaEventsArchive: overrides.getQuotaEventsArchive || getQuotaEventsArchive,
    getArchiveScheduler: overrides.getArchiveScheduler || getArchiveScheduler,
    systemConfigCache: overrides.systemConfigCache || systemConfigCache,
    storagesListCache: overrides.storagesListCache || storagesListCache,
    storagesStatsCache: overrides.storagesStatsCache || storagesStatsCache,
    quotaStatsCache: overrides.quotaStatsCache || quotaStatsCache,
    loadBalanceCache: overrides.loadBalanceCache || loadBalanceCache,
    dashboardOverviewCache: overrides.dashboardOverviewCache || dashboardOverviewCache,
    dashboardUploadTrendCache: overrides.dashboardUploadTrendCache || dashboardUploadTrendCache,
    dashboardAccessStatsCache: overrides.dashboardAccessStatsCache || dashboardAccessStatsCache,
    invalidateAllCaches: overrides.invalidateAllCaches || invalidateAllCaches,
    invalidateDashboardCaches: overrides.invalidateDashboardCaches || invalidateDashboardCaches,
    invalidateFilesCache: overrides.invalidateFilesCache || invalidateFilesCache,
    invalidateStorageCaches: overrides.invalidateStorageCaches || invalidateStorageCaches,
    invalidateSystemConfigCache: overrides.invalidateSystemConfigCache || invalidateSystemConfigCache,
    sanitizeSystemConfig: overrides.sanitizeSystemConfig || sanitizeSystemConfig,
    sanitizeStorageChannel: overrides.sanitizeStorageChannel || sanitizeStorageChannel,
    summarizeStorages: overrides.summarizeStorages || summarizeStorages,
    applySystemConfigUpdates: overrides.applySystemConfigUpdates || applySystemConfigUpdates,
    updateLoadBalanceConfig: overrides.updateLoadBalanceConfig || updateLoadBalanceConfig,
    applyStorageConfigChange: overrides.applyStorageConfigChange || applyStorageConfigChange,
    validateStorageChannelInput: overrides.validateStorageChannelInput || validateStorageChannelInput,
    buildNewStorageChannel: overrides.buildNewStorageChannel || buildNewStorageChannel,
    applyStorageFieldUpdates: overrides.applyStorageFieldUpdates || applyStorageFieldUpdates,
    applyStorageConfigPatch: overrides.applyStorageConfigPatch || applyStorageConfigPatch,
    validStorageTypes: overrides.validStorageTypes || VALID_STORAGE_TYPES,
    preserveNullConfigKeys: overrides.preserveNullConfigKeys || STORAGE_SENSITIVE_KEYS,
    freezeStorageFiles: overrides.freezeStorageFiles || createFreezeStorageFiles(db),
    getActiveFilesStats: overrides.getActiveFilesStats || getActiveFilesStats,
    getTodayUploadCount: overrides.getTodayUploadCount || getTodayUploadCount,
    getUploadTrend: overrides.getUploadTrend || getUploadTrend,
    logger,
  };

  deps.systemConfigService = overrides.systemConfigService || createSystemConfigService({
    readRuntimeConfig: deps.readRuntimeConfig,
    writeRuntimeConfig: deps.writeRuntimeConfig,
    invalidateSystemConfigCache: deps.invalidateSystemConfigCache,
    applySystemConfigUpdates: deps.applySystemConfigUpdates,
  });

  deps.storageConfigService = overrides.storageConfigService || createStorageConfigService({
    readRuntimeConfig: deps.readRuntimeConfig,
    writeRuntimeConfig: deps.writeRuntimeConfig,
    storageManager: deps.storageManager,
    invalidateStorageCaches: deps.invalidateStorageCaches,
    invalidateFilesCache: deps.invalidateFilesCache,
    invalidateDashboardCaches: deps.invalidateDashboardCaches,
    freezeStorageFiles: deps.freezeStorageFiles,
    updateLoadBalanceConfig: deps.updateLoadBalanceConfig,
    applyStorageConfigChange: deps.applyStorageConfigChange,
    validateStorageChannelInput: deps.validateStorageChannelInput,
    buildNewStorageChannel: deps.buildNewStorageChannel,
    applyStorageFieldUpdates: deps.applyStorageFieldUpdates,
    applyStorageConfigPatch: deps.applyStorageConfigPatch,
    validStorageTypes: deps.validStorageTypes,
    preserveNullConfigKeys: deps.preserveNullConfigKeys,
  });

  deps.maintenanceService = overrides.maintenanceService || createMaintenanceService({
    db: deps.db,
    storageManager: deps.storageManager,
    logger: deps.logger,
  });

  deps.dashboardService = overrides.dashboardService || createDashboardService({
    db: deps.db,
    readRuntimeConfig: deps.readRuntimeConfig,
    getActiveFilesStats: deps.getActiveFilesStats,
    getTodayUploadCount: deps.getTodayUploadCount,
    getUploadTrend: deps.getUploadTrend,
    summarizeStorages: deps.summarizeStorages,
  });

  return deps;
}

function createSystemRouter(overrides = {}) {
  const deps = buildSystemDependencies(overrides);
  const router = express.Router();

  router.use(deps.adminAuth);
  router.use(createSystemConfigRouter({
    systemConfigCache: deps.systemConfigCache,
    readRuntimeConfig: deps.readRuntimeConfig,
    sanitizeSystemConfig: deps.sanitizeSystemConfig,
    systemConfigService: deps.systemConfigService,
  }));
  router.use(createSystemStoragesRouter({
    storagesListCache: deps.storagesListCache,
    storagesStatsCache: deps.storagesStatsCache,
    loadBalanceCache: deps.loadBalanceCache,
    quotaStatsCache: deps.quotaStatsCache,
    readRuntimeConfig: deps.readRuntimeConfig,
    sanitizeStorageChannel: deps.sanitizeStorageChannel,
    summarizeStorages: deps.summarizeStorages,
    storageManager: deps.storageManager,
    storageConfigService: deps.storageConfigService,
  }));
  router.use(createSystemMaintenanceRouter({
    maintenanceService: deps.maintenanceService,
  }));
  router.use(createSystemRuntimeRouter({
    getResponseCache: deps.getResponseCache,
    getQuotaEventsArchive: deps.getQuotaEventsArchive,
    getArchiveScheduler: deps.getArchiveScheduler,
    invalidateAllCaches: deps.invalidateAllCaches,
  }));
  router.use(createSystemDashboardRouter({
    dashboardOverviewCache: deps.dashboardOverviewCache,
    dashboardUploadTrendCache: deps.dashboardUploadTrendCache,
    dashboardAccessStatsCache: deps.dashboardAccessStatsCache,
    dashboardService: deps.dashboardService,
  }));

  return router;
}

const systemApp = createSystemRouter();

export { createSystemRouter };

export default systemApp;
