/**
 * 请求限流中间件
 * 使用滑动窗口算法实现精确的速率限制
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 时间窗口（默认 1 分钟）
    this.max = options.max || 100; // 最大请求数
    this.message = options.message || '请求过于频繁，请稍后再试';
    this.statusCode = options.statusCode || 429;
    this.keyGenerator = options.keyGenerator || ((req) => req.get('x-forwarded-for') || req.get('x-real-ip') || req.ip || 'unknown');
    this.skip = options.skip || (() => false);

    // 存储：key -> [timestamp1, timestamp2, ...]
    this.requests = new Map();

    // 定期清理过期数据
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.windowMs);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.requests.entries()) {
      // 移除过期的时间戳
      const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
      if (validTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validTimestamps);
      }
    }
  }

  middleware() {
    return async (req, res, next) => {
      // 跳过检查
      if (this.skip(req)) {
        return next();
      }

      const key = this.keyGenerator(req);
      const now = Date.now();

      // 获取该 key 的请求记录
      let timestamps = this.requests.get(key) || [];

      // 移除过期的时间戳
      timestamps = timestamps.filter(ts => now - ts < this.windowMs);

      // 检查是否超过限制
      if (timestamps.length >= this.max) {
        const oldestTimestamp = timestamps[0];
        const resetTime = oldestTimestamp + this.windowMs;
        const retryAfter = Math.ceil((resetTime - now) / 1000);

        return res.status(this.statusCode).json({
          code: this.statusCode,
          message: this.message,
          data: {
            limit: this.max,
            remaining: 0,
            reset: new Date(resetTime).toISOString(),
            retryAfter,
          },
        });
      }

      // 记录本次请求
      timestamps.push(now);
      this.requests.set(key, timestamps);

      // 设置响应头
      res.setHeader('X-RateLimit-Limit', String(this.max));
      res.setHeader('X-RateLimit-Remaining', String(this.max - timestamps.length));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + this.windowMs) / 1000)));

      return next();
    };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.requests.clear();
  }
}

// 预定义的限流器
const createUploadLimiter = () => new RateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 10, // 最多 10 次上传
  message: '上传过于频繁，请稍后再试',
});

const createApiLimiter = () => new RateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 100, // API 每分钟 100 次
  message: 'API 请求过于频繁，请稍后再试',
});

const createAuthLimiter = () => new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 5, // 最多 5 次登录尝试
  message: '登录尝试过于频繁，请 15 分钟后再试',
  keyGenerator: (req) => {
    // 对于登录接口，使用用户名作为 key
    const body = req.body || {};
    return body.username || req.get('x-forwarded-for') || req.ip || 'unknown';
  },
});

export { RateLimiter,
  createUploadLimiter,
  createApiLimiter,
  createAuthLimiter, };
