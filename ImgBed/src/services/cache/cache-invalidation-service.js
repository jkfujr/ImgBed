import { createLogger } from '../../utils/logger.js';
import { getResponseCache } from './response-cache.js';
import {
  DASHBOARD_CACHES_PREFIX,
  FILES_CACHE_PREFIX,
  LOAD_BALANCE_CACHE_PREFIX,
  QUOTA_STATS_CACHE_PREFIX,
  STORAGE_LIST_CACHE_PREFIX,
  STORAGE_STATS_CACHE_PREFIX,
  SYSTEM_CONFIG_CACHE_PREFIX,
} from './cache-groups.js';

const log = createLogger('cache-invalidation');

function createCacheInvalidationService({
  getCache = getResponseCache,
  logger = log,
} = {}) {
  return {
    invalidateFilesCache() {
      const cache = getCache();
      cache.deleteByPrefix(FILES_CACHE_PREFIX);
      logger.info('文件相关缓存已失效');
    },

    invalidateSystemConfigCache() {
      const cache = getCache();
      cache.deleteByPrefix(SYSTEM_CONFIG_CACHE_PREFIX);
      logger.info('系统配置缓存已失效');
    },

    invalidateStorageCaches() {
      const cache = getCache();
      cache.deleteByPrefix(STORAGE_LIST_CACHE_PREFIX);
      cache.deleteByPrefix(STORAGE_STATS_CACHE_PREFIX);
      cache.deleteByPrefix(QUOTA_STATS_CACHE_PREFIX);
      cache.deleteByPrefix(LOAD_BALANCE_CACHE_PREFIX);
      logger.info('存储渠道相关缓存已失效');
    },

    invalidateDashboardCaches() {
      const cache = getCache();
      cache.deleteByPrefix(DASHBOARD_CACHES_PREFIX);
      logger.info('仪表盘相关缓存已失效');
    },

    invalidateAllCaches() {
      const cache = getCache();
      cache.clear();
      logger.info('所有缓存已失效');
    },
  };
}

const defaultCacheInvalidationService = createCacheInvalidationService();

function invalidateFilesCache() {
  return defaultCacheInvalidationService.invalidateFilesCache();
}

function invalidateSystemConfigCache() {
  return defaultCacheInvalidationService.invalidateSystemConfigCache();
}

function invalidateStorageCaches() {
  return defaultCacheInvalidationService.invalidateStorageCaches();
}

function invalidateDashboardCaches() {
  return defaultCacheInvalidationService.invalidateDashboardCaches();
}

function invalidateAllCaches() {
  return defaultCacheInvalidationService.invalidateAllCaches();
}

export {
  createCacheInvalidationService,
  invalidateAllCaches,
  invalidateDashboardCaches,
  invalidateFilesCache,
  invalidateStorageCaches,
  invalidateSystemConfigCache,
};
