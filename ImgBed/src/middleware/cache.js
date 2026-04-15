/**
 * 响应缓存中间件
 * 用于缓存 GET 请求的响应结果
 */

import { getResponseCache } from '../services/cache/response-cache.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cache-middleware');

function getCacheIdentity(req) {
  const auth = req.auth;
  if (!auth) {
    return 'anonymous';
  }

  if (auth.type === 'api_token') {
    return `api_token:${auth.tokenId || auth.id || 'unknown'}`;
  }

  if (auth.type === 'guest') {
    return 'guest';
  }

  if (auth.type === 'admin_jwt') {
    return `admin_jwt:${auth.username || req.user?.username || 'unknown'}`;
  }

  return `${auth.type || 'unknown'}:${auth.username || auth.tokenId || auth.id || 'unknown'}`;
}

function buildIdentityCacheKey(prefix, req, params = {}) {
  const cache = getResponseCache();
  return cache.buildKey(prefix, {
    identity: getCacheIdentity(req),
    ...params,
  });
}

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
    throw new Error('缓存中间件必须指定前缀');
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
      // 默认使用用户身份 + 查询参数构建缓存键
      cacheKey = buildIdentityCacheKey(prefix, req, req.query);
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

export {
  buildIdentityCacheKey,
  getCacheIdentity,
};
