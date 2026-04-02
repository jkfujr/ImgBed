const { Hono } = require('hono');
const { Readable } = require('stream');
const { db } = require('../database');
const config = require('../config');
const storageManager = require('../storage/manager');
const ChunkManager = require('../storage/chunk-manager');

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
        const fileRecord = await db.selectFrom('files').selectAll().where('id', '=', id).executeTakeFirst();
        
        if (!fileRecord) {
             // 针对作为根路径映射的情况，如果是没找到记录，返回 404 JSON (符合 app.js 定义的 404 风格)
             return c.json({
                code: 404,
                message: '文件未找到或标识符无效',
                data: {}
             }, 404);
        }

        // 如果文件非完全公开且系统定义需要权限的话，这里可以加上补充验证；此处默认所有有效ID皆可用。
        
        // 获取渠道对象
        let configObj = {};
        try { configObj = JSON.parse(fileRecord.storage_config || '{}'); } catch(e){}
        const instanceId = configObj.instance_id;
        let storage = storageManager.getStorage(instanceId);

        // --- 开始向后兼容打补丁: 针对 imgbed_backup 导入的无 instanceId 古董记录的临时装载 ---
        if (!storage) {
             if (fileRecord.storage_channel === 'telegram' && fileRecord.telegram_bot_token) {
                 const TelegramStorage = require('../storage/telegram');
                 storage = new TelegramStorage({ botToken: fileRecord.telegram_bot_token });
             } else if (fileRecord.storage_channel === 'discord') {
                 // discord 因为无法提取持久化botToken（部分早期版只暴露ID），也许需从统一配置取代理，或者如果有的话就吃进去
                 const dToken = configObj.original_meta?.DiscordBotToken || config.storage?.discordLegacyToken || '';
                 const DiscordStorage = require('../storage/discord');
                 storage = new DiscordStorage({ botToken: dToken });
             } else if (fileRecord.storage_channel === 's3' && configObj.legacy_s3) {
                 const S3Storage = require('../storage/s3');
                 storage = new S3Storage(configObj.legacy_s3);
             } else if (fileRecord.storage_channel === 'external' || fileRecord.storage_channel === 'huggingface') {
                 // 纯降级外部链接 (如 OneDrive) 回退
                 const ExternalStorage = require('../storage/external');
                 storage = new ExternalStorage({ baseUrl: '' });
                 fileRecord.storage_key = configObj.original_meta?.Url || fileRecord.storage_key; // 强制用绝对地址替换
             }
        }
        // --- 结束补丁 ---

        if (!storage) {
             return c.json({ code: 500, message: `图床渠道调度失败，丢失底层映射处理器及备用配置: ${instanceId || fileRecord.storage_channel}` }, 500);
        }

        // 3. 拦截请求头内的 Range 进行断点续传/音视频拖动流处理配置截取
        const requestRange = c.req.header('Range');
        let options = {};
        let isPartial = false;
        let start = 0;
        let end = fileRecord.size - 1;

        if (requestRange) {
             const parts = requestRange.replace(/bytes=/, '').split('-');
             const reqStart = parseInt(parts[0], 10);
             const reqEnd = parts[1] ? parseInt(parts[1], 10) : end;
             
             if (!isNaN(reqStart)) {
                 start = reqStart;
                 end = Math.min(reqEnd, fileRecord.size - 1);
                 options = { start, end };
                 isPartial = true;
             }
        }

        // 4. 分块文件合并读取
        if (fileRecord.is_chunked) {
            const chunks = await ChunkManager.getChunks(fileRecord.id);
            if (!chunks || chunks.length === 0) {
                return c.json({ code: 500, message: '分块记录缺失，无法重组文件' }, 500);
            }

            const totalSize = fileRecord.size;
            const getStorageFn = (storageId) => storageManager.getStorage(storageId);

            const mergedStream = ChunkManager.createChunkedReadStream(chunks, getStorageFn, {
                start, end, totalSize
            });

            const headers = new Headers();
            headers.set('Content-Type', fileRecord.mime_type || 'application/octet-stream');
            headers.set('Cache-Control', 'public, max-age=31536000');
            headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileRecord.original_name)}`);

            if (isPartial) {
                headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
                headers.set('Content-Length', String(end - start + 1));
                headers.set('Accept-Ranges', 'bytes');
            } else {
                headers.set('Content-Length', String(totalSize));
                headers.set('Accept-Ranges', 'bytes');
            }

            return new Response(mergedStream, {
                status: isPartial ? 206 : 200,
                headers
            });
        }

        // 5. 调用渠道 getStream 拉流
        const fileStream = await storage.getStream(fileRecord.storage_key, options).catch(e => {
            console.error(`[View API] 拉取真实流 ${fileRecord.storage_key} 出错:`, e.message);
            return null;
        });

        if (!fileStream) {
             return c.json({ code: 502, message: '向原点提取文件内容失败，上游节点未响应' }, 502);
        }

        // 6. 配置响应头并回写流给前端
        const headers = new Headers();
        headers.set('Content-Type', fileRecord.mime_type || 'application/octet-stream');
        headers.set('Cache-Control', 'public, max-age=31536000'); // 默认缓存
        headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileRecord.original_name)}`);

        if (isPartial) {
            headers.set('Content-Range', `bytes ${start}-${end}/${fileRecord.size}`);
            headers.set('Content-Length', String(end - start + 1));
            headers.set('Accept-Ranges', 'bytes');
        } else {
            headers.set('Content-Length', String(fileRecord.size));
            headers.set('Accept-Ranges', 'bytes');
        }
        
        let responseStream = fileStream;
        if (fileStream instanceof Readable) {
             responseStream = Readable.toWeb(fileStream);
        }

        return new Response(responseStream, {
            status: isPartial ? 206 : 200,
            headers: headers
        });
    } catch (err) {
        console.error('[View API] 公共分发端点严重崩溃:', err);
        return c.json({ code: 500, message: '分流异常', error: err.message }, 500);
    }
});

module.exports = viewApp;
