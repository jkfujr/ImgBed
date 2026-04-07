import express from 'express';
import { sqlite } from '../database/index.js';
import config from '../config/index.js';
import storageManager from '../storage/manager.js';
import ChunkManager from '../storage/chunk-manager.js';
import { resolveFileStorage, parseRangeHeader } from '../services/view/resolve-file-storage.js';
import { handleChunkedStream, handleRegularStream } from '../services/view/handle-stream.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';

const viewApp = express.Router();

/**
 * 校验反盗链逻辑
 */
const checkReferer = (req) => {
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
viewApp.get('/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;

    if (!checkReferer(req)) {
        throw new ForbiddenError('禁止访问');
    }

    const fileRecord = sqlite.prepare('SELECT * FROM files WHERE id = ? LIMIT 1').get(id);

    if (!fileRecord) {
        throw new NotFoundError('文件未找到或标识符无效');
    }

    // 记录访问日志（异步，不阻塞响应）
    setImmediate(() => {
        try {
            const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
            const userAgent = req.headers['user-agent'] || null;
            const referer = req.headers['referer'] || null;

            // 检测是否为管理员访问（通过 Authorization header 或 referer 包含 /admin）
            const isAdmin = !!(req.headers['authorization'] || (referer && referer.includes('/admin')));

            sqlite.prepare(`
                INSERT INTO access_logs (file_id, ip, user_agent, referer, is_admin)
                VALUES (?, ?, ?, ?, ?)
            `).run(id, ip, userAgent, referer, isAdmin ? 1 : 0);
        } catch (error) {
            // 日志记录失败不影响文件访问
            console.error('Failed to log access:', error);
        }
    });

    const { storage, storageKey } = resolveFileStorage(fileRecord, { storageManager });

    const requestRange = req.get('Range');
    const { start, end, isPartial } = parseRangeHeader(requestRange, fileRecord.size);

    if (fileRecord.is_chunked) {
        return await handleChunkedStream(fileRecord, res, { start, end, isPartial, storageManager });
    } else {
        return await handleRegularStream(fileRecord, res, storage, storageKey, { start, end, isPartial });
    }
}));

export default viewApp;
