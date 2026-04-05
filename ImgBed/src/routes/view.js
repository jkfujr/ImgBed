import { Hono } from 'hono';
import { Readable } from 'stream';
import { sqlite } from '../database/index.js';
import config from '../config/index.js';
import storageManager from '../storage/manager.js';
import ChunkManager from '../storage/chunk-manager.js';
import { resolveFileStorage, parseRangeHeader, buildStreamHeaders } from '../services/view/resolve-file-storage.js';
import { handleChunkedStream, handleRegularStream } from '../services/view/handle-stream.js';

const viewApp = new Hono();

/**
 * 校验反盗链逻辑
 * 只有当来源被允许，或者请求方没有来源（直接敲网址）才放行
 */
const checkReferer = (c) => {
    // 检查是否有配置安全名单
    const security = config.security || {};
    const allowed = security.allowedDomains;

    if (!Array.isArray(allowed) || allowed.length === 0) {
        return true; // 空白名单视作不限制
    }

    const referer = c.req.header('Referer') || c.req.header('Origin');
    if (!referer) {
       // 未匹配 referer 一般默认放宽给客户端直接访问，除非有更严格的要求
       return true; 
    }

    try {
        const url = new URL(referer);
        const domain = url.hostname;
        
        // 支持通配符或者精准匹配 (极简判断实现)
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
viewApp.get('/:id', async (c) => {
    try {
        const id = c.req.param('id');

        // 1. 防盗链拦截
        if (!checkReferer(c)) {
             return c.text('403 Forbidden', 403);
        }

        // 2. 查库获取元数据
        const fileRecord = sqlite.prepare('SELECT * FROM files WHERE id = ? LIMIT 1').get(id);

        if (!fileRecord) {
             return c.json({
                code: 404,
                message: '文件未找到或标识符无效',
                data: {}
             }, 404);
        }

        // 3. 解析存储渠道（含 legacy 兼容）
        const { storage, storageKey } = resolveFileStorage(fileRecord, { storageManager, config });

        // 4. 解析 Range 请求头
        const requestRange = c.req.header('Range');
        const { start, end, isPartial } = parseRangeHeader(requestRange, fileRecord.size);

        // 5. 分块文件与普通文件分别处理
        if (fileRecord.is_chunked) {
            return await handleChunkedStream(fileRecord, { start, end, isPartial, storageManager });
        } else {
            return await handleRegularStream(fileRecord, storage, storageKey, { start, end, isPartial });
        }
    } catch (err) {
        if (err.status) {
            return c.json({ code: err.status, message: err.message }, err.status);
        }
        console.error('[View API] 公共分发端点严重崩溃:', err);
        return c.json({ code: 500, message: '分流异常', error: err.message }, 500);
    }
});

export default viewApp;
