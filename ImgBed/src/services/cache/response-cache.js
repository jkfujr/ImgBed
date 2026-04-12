import { createLogger } from '../../utils/logger.js';

const log = createLogger('response-cache');

class ResponseCache {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.ttlSeconds = options.ttlSeconds || 60;
    this.maxKeys = options.maxKeys || 1000;
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
    };
    this.cleanupInterval = setInterval(() => this._cleanup(), 30000);

    log.info(
      { enabled: this.enabled, ttlSeconds: this.ttlSeconds, maxKeys: this.maxKeys },
      '响应缓存服务已初始化'
    );
  }

  buildKey(prefix, params = {}) {
    const sortedKeys = Object.keys(params).sort();
    const parts = sortedKeys.map((k) => {
      const v = params[k];
      if (v === null || v === undefined) return `${k}:null`;
      if (typeof v === 'boolean') return `${k}:${v ? '1' : '0'}`;
      return `${k}:${v}`;
    });
    return `${prefix}:${parts.join(':')}`;
  }

  get(key) {
    if (!this.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  set(key, value, ttl) {
    if (!this.enabled) return;

    const ttlMs = (ttl || this.ttlSeconds) * 1000;
    const expireAt = Date.now() + ttlMs;

    if (this.cache.size >= this.maxKeys && !this.cache.has(key)) {
      this._evictOldest();
    }

    this.cache.set(key, { value, expireAt });
    this.stats.sets++;
  }

  delete(key) {
    if (!this.enabled) return;

    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
    }
  }

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
      log.debug({ prefix, count }, '已按前缀批量删除缓存');
    }

    return count;
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    log.info({ clearedKeys: size }, '已清空所有缓存');
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      currentKeys: this.cache.size,
      maxKeys: this.maxKeys,
      enabled: this.enabled,
    };
  }

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
      log.debug({ cleaned, remaining: this.cache.size }, '已清理过期缓存');
    }
  }

  _evictOldest() {
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

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    log.info('响应缓存服务已销毁');
  }
}

let responseCacheInstance = null;

export function initResponseCache(config = {}) {
  if (responseCacheInstance) {
    responseCacheInstance.destroy();
  }

  responseCacheInstance = new ResponseCache(config);
  return responseCacheInstance;
}

export function getResponseCache() {
  if (!responseCacheInstance) {
    responseCacheInstance = new ResponseCache();
  }
  return responseCacheInstance;
}

export default ResponseCache;
