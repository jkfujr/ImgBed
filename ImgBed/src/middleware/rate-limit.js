import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { getRequestIp } from '../utils/request-ip.js';

const RATE_LIMIT_RESPONSE = {
  code: 429,
  message: '请求过于频繁，请稍后重试',
};

function createRateLimiter({
  windowMs,
  limit,
  identifier,
  keyPrefix = identifier || 'request',
  skip,
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    identifier,
    skip,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${keyPrefix}:${ipKeyGenerator(getRequestIp(req))}`,
    handler: (_req, res) => {
      res.status(429).json(RATE_LIMIT_RESPONSE);
    },
  });
}

const spaFallbackRateLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: 120,
  identifier: 'spa-fallback',
});

export {
  RATE_LIMIT_RESPONSE,
  createRateLimiter,
  spaFallbackRateLimiter,
};
