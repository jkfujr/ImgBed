/**
 * 响应缓存中间件
 * 用于缓存 GET 请求的响应结果
 */

import { getResponseCache } from '../services/cache/response-cache.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cache-middleware');

/**
 * 创建响应缓存中间件
 * @param {Object} options
 * @param {string} options.prefix - 缓存键前缀
 * @param {Function} [options.keyBuilder] - 自定义缓存键生成函数
 * @param {number} [options.ttl] - 自定义 TTL（秒）
 * @param {Function} [options.shouldCache] - 判断是否应该缓存的函数
 * @returns {Function}
 */
export function cacheMiddleware(options = {}) {
  const { prefix, keyBuilder, ttl, shouldCache } = options;

  if (!prefix) {
    throw new Error('缓存中间件必须指定 prefix');
  }

  return async (req, res, next) => {
    // 只缓存 GET 请求
    if (req.method !== 'GET') {
      return next();
    }

    const cache = getResponseCache();

    // 如果缓存未启用，直接跳过
    if (!cache.enabled) {
      return next();
    }

    // 生成缓存键
    let cacheKey;
    if (keyBuilder) {
      cacheKey = keyBuilder(req);
    } else {
      // 默认使用查询参数构建缓存键
      cacheKey = cache.buildKey(prefix, req.query);
    }

    // 尝试从缓存获取
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) {
      log.debug({ cacheKey, hit: true }, '缓存命中');
      return res.json(cachedResponse);
    }

    // 缓存未命中，拦截响应
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // 判断是否应该缓存此响应
      if (shouldCache && !shouldCache(req, res, data)) {
        return originalJson(data);
      }

      // 只缓存成功响应
      if (data && data.code === 0) {
        cache.set(cacheKey, data, ttl);
        log.debug({ cacheKey, hit: false }, '缓存未命中，已回填');
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * 文件列表缓存中间件
 * 根据分页、目录、搜索参数生成缓存键
 */
export function filesListCache() {
  return cacheMiddleware({
    prefix: 'files:list',
    keyBuilder: (req) => {
      const cache = getResponseCache();
      return cache.buildKey('files:list', {
        page: req.query.page || '1',
        pageSize: req.query.pageSize || '20',
        directory: req.query.directory || '',
        search: req.query.search || ''
      });
    },
    ttl: 30 // 文件列表缓存 30 秒
  });
}

/**
 * 系统配置缓存中间件
 */
export function systemConfigCache() {
  return cacheMiddleware({
    prefix: 'system:config',
    ttl: 60 // 系统配置缓存 60 秒
  });
}

/**
 * 存储渠道列表缓存中间件
 */
export function storagesListCache() {
  return cacheMiddleware({
    prefix: 'system:storages',
    ttl: 60
  });
}

/**
 * 存储统计缓存中间件
 */
export function storagesStatsCache() {
  return cacheMiddleware({
    prefix: 'system:storages:stats',
    ttl: 30
  });
}

/**
 * 容量统计缓存中间件
 */
export function quotaStatsCache() {
  return cacheMiddleware({
    prefix: 'system:quota-stats',
    ttl: 30
  });
}

/**
 * 负载均衡配置缓存中间件
 */
export function loadBalanceCache() {
  return cacheMiddleware({
    prefix: 'system:load-balance',
    ttl: 60
  });
}

/**
 * 仪表盘概览缓存中间件
 */
export function dashboardOverviewCache() {
  return cacheMiddleware({
    prefix: 'system:dashboard:overview',
    ttl: 30
  });
}

/**
 * 仪表盘上传趋势缓存中间件
 */
export function dashboardUploadTrendCache() {
  return cacheMiddleware({
    prefix: 'system:dashboard:upload-trend',
    keyBuilder: (req) => {
      const cache = getResponseCache();
      return cache.buildKey('system:dashboard:upload-trend', {
        days: req.query.days || '7'
      });
    },
    ttl: 60
  });
}

/**
 * 仪表盘访问统计缓存中间件
 */
export function dashboardAccessStatsCache() {
  return cacheMiddleware({
    prefix: 'system:dashboard:access-stats',
    ttl: 30
  });
}

/**
 * 缓存失效辅助函数
 */
export const cacheInvalidation = {
  /**
   * 使文件相关缓存失效
   */
  invalidateFiles() {
    const cache = getResponseCache();
    cache.deleteByPrefix('files:');
    log.info('文件相关缓存已失效');
  },

  /**
   * 使系统配置缓存失效
   */
  invalidateSystemConfig() {
    const cache = getResponseCache();
    cache.deleteByPrefix('system:config');
    log.info('系统配置缓存已失效');
  },

  /**
   * 使存储渠道缓存失效
   */
  invalidateStorages() {
    const cache = getResponseCache();
    cache.deleteByPrefix('system:storages');
    cache.deleteByPrefix('system:quota-stats');
    cache.deleteByPrefix('system:load-balance');
    log.info('存储渠道相关缓存已失效');
  },

  /**
   * 使仪表盘缓存失效
   */
  invalidateDashboard() {
    const cache = getResponseCache();
    cache.deleteByPrefix('system:dashboard:');
    log.info('仪表盘相关缓存已失效');
  },

  /**
   * 使所有缓存失效
   */
  invalidateAll() {
    const cache = getResponseCache();
    cache.clear();
    log.info('所有缓存已失效');
  }
};
