/**
 * 响应缓存服务
 * 提供轻量级进程内 TTL 缓存，用于优化高频只读接口
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('response-cache');

class ResponseCache {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.ttlSeconds = options.ttlSeconds || 60;
    this.maxKeys = options.maxKeys || 1000;

    // 缓存存储: Map<key, { value, expireAt }>
    this.cache = new Map();

    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };

    // 定期清理过期缓存
    this.cleanupInterval = setInterval(() => this._cleanup(), 30000);

    log.info({ enabled: this.enabled, ttlSeconds: this.ttlSeconds, maxKeys: this.maxKeys }, '响应缓存服务已初始化');
  }

  /**
   * 生成缓存键
   * @param {string} prefix - 键前缀
   * @param {Object} params - 参数对象
   * @returns {string}
   */
  buildKey(prefix, params = {}) {
    const sortedKeys = Object.keys(params).sort();
    const parts = sortedKeys.map(k => {
      const v = params[k];
      // 标准化布尔值和空值
      if (v === null || v === undefined) return `${k}:null`;
      if (typeof v === 'boolean') return `${k}:${v ? '1' : '0'}`;
      return `${k}:${v}`;
    });
    return `${prefix}:${parts.join(':')}`;
  }

  /**
   * 获取缓存值
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    if (!this.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * 设置缓存值
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl] - 可选的自定义 TTL（秒）
   */
  set(key, value, ttl) {
    if (!this.enabled) return;

    const ttlMs = (ttl || this.ttlSeconds) * 1000;
    const expireAt = Date.now() + ttlMs;

    // 检查是否超过最大键数量
    if (this.cache.size >= this.maxKeys && !this.cache.has(key)) {
      this._evictOldest();
    }

    this.cache.set(key, { value, expireAt });
    this.stats.sets++;
  }

  /**
   * 删除单个缓存键
   * @param {string} key
   */
  delete(key) {
    if (!this.enabled) return;

    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
  }

  /**
   * 按前缀批量删除缓存键
   * @param {string} prefix
   * @returns {number} 删除的键数量
   */
  deleteByPrefix(prefix) {
    if (!this.enabled) return 0;

    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.stats.deletes += count;
      log.debug({ prefix, count }, '按前缀批量删除缓存');
    }

    return count;
  }

  /**
   * 清空所有缓存
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    log.info({ clearedKeys: size }, '清空所有缓存');
  }

  /**
   * 获取缓存统计信息
   * @returns {Object}
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      currentKeys: this.cache.size,
      maxKeys: this.maxKeys,
      enabled: this.enabled
    };
  }

  /**
   * 清理过期缓存
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expireAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug({ cleaned, remaining: this.cache.size }, '清理过期缓存');
    }
  }

  /**
   * 驱逐最旧的缓存项
   * @private
   */
  _evictOldest() {
    // 找到最早过期的项
    let oldestKey = null;
    let oldestExpireAt = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expireAt < oldestExpireAt) {
        oldestExpireAt = entry.expireAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 销毁缓存服务
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    log.info('响应缓存服务已销毁');
  }
}

// 创建全局单例
let responseCacheInstance = null;

/**
 * 初始化响应缓存服务
 * @param {Object} config
 */
export function initResponseCache(config = {}) {
  if (responseCacheInstance) {
    responseCacheInstance.destroy();
  }

  responseCacheInstance = new ResponseCache(config);
  return responseCacheInstance;
}

/**
 * 获取响应缓存实例
 * @returns {ResponseCache}
 */
export function getResponseCache() {
  if (!responseCacheInstance) {
    responseCacheInstance = new ResponseCache();
  }
  return responseCacheInstance;
}

export default ResponseCache;
