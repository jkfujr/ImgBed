import { cacheMiddleware, buildIdentityCacheKey } from '../../middleware/cache.js';
import {
  DASHBOARD_ACCESS_STATS_CACHE_PREFIX,
  DASHBOARD_OVERVIEW_CACHE_PREFIX,
  DASHBOARD_UPLOAD_TREND_CACHE_PREFIX,
  LOAD_BALANCE_CACHE_PREFIX,
  QUOTA_STATS_CACHE_PREFIX,
  STORAGE_LIST_CACHE_PREFIX,
  STORAGE_STATS_CACHE_PREFIX,
  SYSTEM_CONFIG_CACHE_PREFIX,
} from '../../services/cache/cache-groups.js';

function systemConfigCache() {
  return cacheMiddleware({
    prefix: SYSTEM_CONFIG_CACHE_PREFIX,
    ttl: 60,
  });
}

function storagesListCache() {
  return cacheMiddleware({
    prefix: STORAGE_LIST_CACHE_PREFIX,
    ttl: 60,
  });
}

function storagesStatsCache() {
  return cacheMiddleware({
    prefix: STORAGE_STATS_CACHE_PREFIX,
    ttl: 30,
  });
}

function quotaStatsCache() {
  return cacheMiddleware({
    prefix: QUOTA_STATS_CACHE_PREFIX,
    ttl: 30,
  });
}

function loadBalanceCache() {
  return cacheMiddleware({
    prefix: LOAD_BALANCE_CACHE_PREFIX,
    ttl: 60,
  });
}

function dashboardOverviewCache() {
  return cacheMiddleware({
    prefix: DASHBOARD_OVERVIEW_CACHE_PREFIX,
    ttl: 30,
  });
}

function dashboardUploadTrendCache() {
  return cacheMiddleware({
    prefix: DASHBOARD_UPLOAD_TREND_CACHE_PREFIX,
    keyBuilder: (req) => buildIdentityCacheKey(DASHBOARD_UPLOAD_TREND_CACHE_PREFIX, req, {
      days: req.query.days || '7',
    }),
    ttl: 60,
  });
}

function dashboardAccessStatsCache() {
  return cacheMiddleware({
    prefix: DASHBOARD_ACCESS_STATS_CACHE_PREFIX,
    ttl: 30,
  });
}

export {
  dashboardAccessStatsCache,
  dashboardOverviewCache,
  dashboardUploadTrendCache,
  loadBalanceCache,
  quotaStatsCache,
  storagesListCache,
  storagesStatsCache,
  systemConfigCache,
};
