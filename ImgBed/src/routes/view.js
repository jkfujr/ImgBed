import express from 'express';
import crypto from 'crypto';
import { sqlite } from '../database/index.js';
import { getActiveFileById, insertAccessLog } from '../database/files-dao.js';
import { getLastKnownGoodConfig } from '../config/index.js';
import storageManager from '../storage/manager.js';
import { resolveFileStorage, parseRangeHeader } from '../services/view/resolve-file-storage.js';
import { handleChunkedStream, handleRegularStream } from '../services/view/handle-stream.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('view');
const viewApp = express.Router();
const FILE_ID_PATTERN = /^[0-9a-f]{12}_[0-9A-Za-z_\p{Script=Han}]+\.[A-Za-z0-9]+$/u;

/**
 * 生成 ETag（基于文件 ID 和更新时间）
 */
const generateETag = (fileRecord) => {
  const hash = crypto.createHash('md5')
    .update(`${fileRecord.id}-${fileRecord.updated_at || fileRecord.created_at}`)
    .digest('hex');
  return `"${hash}"`;
};

/**
 * 检查缓存是否有效
 */
const checkCache = (req, fileRecord, etag) => {
  const ifNoneMatch = req.get('If-None-Match');
  const ifModifiedSince = req.get('If-Modified-Since');

  // 优先检查 ETag
  if (ifNoneMatch && ifNoneMatch === etag) {
    return true;
  }

  // 检查 Last-Modified
  if (ifModifiedSince && fileRecord.updated_at) {
    const modifiedTime = new Date(fileRecord.updated_at).getTime();
    const requestTime = new Date(ifModifiedSince).getTime();
    if (modifiedTime <= requestTime) {
      return true;
    }
  }

  return false;
};

/**
 * 校验反盗链逻辑
 */
const checkReferer = (req) => {
    const config = getLastKnownGoodConfig();
    const security = config.security || {};
    const allowed = security.allowedDomains;

    if (!Array.isArray(allowed) || allowed.length === 0) {
        return true;
    }

    const referer = req.get('Referer') || req.get('Origin');
    if (!referer) {
       return true;
    }

    try {
        const url = new URL(referer);
        const domain = url.hostname;

        return allowed.some(rule => {
             if (rule.startsWith('*.')) {
                 const baseDomain = rule.slice(2);
                 return domain === baseDomain || domain.endsWith('.' + baseDomain);
             }
             return domain === rule;
        });
    } catch(err) {
        return false;
    }
};

/**
 * 获取具体文件的直读数据流
 * GET /:id
 */
viewApp.get('/:id', asyncHandler(async (req, res, next) => {
    const id = req.params.id;
    if (!FILE_ID_PATTERN.test(id)) {
        next();
        return;
    }

    const startTime = Date.now();

    // 设置请求超时（15秒）
    req.setTimeout(15000, () => {
        log.warn({ id }, '图片请求超时');
        if (!res.headersSent) {
            res.status(504).json({ code: 504, message: '请求超时' });
        }
    });

    // 设置响应超时
    res.setTimeout(15000, () => {
        log.warn({ id }, '响应超时');
    });

    if (!checkReferer(req)) {
        throw new ForbiddenError('禁止访问');
    }

    const fileRecord = getActiveFileById(sqlite, id);

    if (!fileRecord) {
        throw new NotFoundError('文件未找到或标识符无效');
    }

    // 生成 ETag 和 Last-Modified
    const etag = generateETag(fileRecord);
    const lastModified = fileRecord.updated_at || fileRecord.created_at;

    // 检查缓存是否有效，返回 304
    if (checkCache(req, fileRecord, etag)) {
        res.status(304).end();
        return;
    }

    // 记录访问日志（异步，不阻塞响应）
    setImmediate(() => {
        try {
            const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
            const userAgent = req.headers['user-agent'] || null;
            const referer = req.headers['referer'] || null;

            // 检测是否为管理员访问（通过 Authorization header 或 referer 包含 /admin）
            const isAdmin = !!(req.headers['authorization'] || (referer && referer.includes('/admin')));

            insertAccessLog(sqlite, {
                fileId: id,
                ip,
                userAgent,
                referer,
                isAdmin: isAdmin ? 1 : 0,
            });
        } catch (error) {
            // 日志记录失败不影响文件访问
            log.error({ err: error }, '访问日志记录失败');
        }
    });

    try {
        const { storage, storageKey } = resolveFileStorage(fileRecord, { storageManager });

        const requestRange = req.get('Range');
        const { start, end, isPartial } = parseRangeHeader(requestRange, fileRecord.size);

        if (fileRecord.is_chunked) {
            await handleChunkedStream(fileRecord, res, { start, end, isPartial, storageManager, etag, lastModified });
        } else {
            await handleRegularStream(fileRecord, res, storage, storageKey, { start, end, isPartial, etag, lastModified });
        }

        const duration = Date.now() - startTime;
        log.debug({ id, duration }, '图片请求完成');
    } catch (err) {
        const duration = Date.now() - startTime;
        log.error({ id, duration, err }, '图片请求失败');
        throw err;
    }
}));

export default viewApp;
