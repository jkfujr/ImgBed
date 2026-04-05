import { Hono } from 'hono';
import { sqlite } from '../database/index.js';
import { adminAuth, requirePermission } from '../middleware/auth.js';
import storageManager from '../storage/manager.js';
import ChunkManager from '../storage/chunk-manager.js';
import { deleteFileRecord } from '../services/files/delete-file.js';
import { executeFilesBatchAction } from '../services/files/batch-action.js';
import { rebuildMetadataTask } from '../services/files/rebuild-metadata.js';

const filesApp = new Hono();

/**
 * 文件列表接口 (带分页与简单过滤)
 * GET /api/files
 */
filesApp.get('/', requirePermission('files:read'), async (c) => {
    try {
        const page = parseInt(c.req.query('page') || '1');
        const pageSize = parseInt(c.req.query('pageSize') || '20');
        const directory = c.req.query('directory'); // 目录筛选目录
        const search = c.req.query('search'); // 文件名搜索关键词

        // 列表接口排除 exif 字段以减小体积，仅返回宽高
        // SQL 拼装
        const conditions = [];
        const params = [];

        if (directory) {
            conditions.push('directory = ?');
            params.push(directory);
        }

        if (search) {
            conditions.push('file_name LIKE ?');
            params.push(`%${search}%`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const offset = (page - 1) * pageSize;

        const listStmt = sqlite.prepare(
            `SELECT id, file_name, original_name, mime_type, size,
                    storage_channel, storage_key, storage_config,
                    upload_ip, upload_address, created_at, updated_at,
                    directory, tags, is_public,
                    width, height, uploader_type, uploader_id
             FROM files
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
        );

        const countStmt = sqlite.prepare(
            `SELECT COUNT(id) AS total FROM files ${whereClause}`
        );

        const list = listStmt.all(...params, pageSize, offset);
        const countResult = countStmt.get(...params) || { total: 0 };

        const total = Number(countResult.total || 0);
        const totalPages = Math.ceil(total / pageSize);

        return c.json({
            code: 0,
            message: 'success',
            data: {
                list,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages
                }
            }
        });
    } catch (err) {
        console.error('[Files API] 查询文件列表失败:', err);
        return c.json({ code: 500, message: '网络请求或数据库错误: 无法获取列表', error: err.message }, 500);
    }
});

/**
 * 获取文件详细信息
 * GET /api/files/:id
 */
filesApp.get('/:id', requirePermission('files:read'), async (c) => {
    try {
        const id = c.req.param('id');
        const file = sqlite.prepare('SELECT * FROM files WHERE id = ? LIMIT 1').get(id);
        
        if (!file) {
            return c.json({ code: 404, message: '抱歉，指定的文件未找到', error: {} }, 404);
        }

        return c.json({ code: 0, message: 'success', data: file });
    } catch (err) {
        console.error('[Files API] 获取单文件数据崩溃:', err);
        return c.json({ code: 500, message: '无法获取其详情概览', error: err.message }, 500);
    }
});

/**
 * 修改文件属性名称或改变所处逻辑目录
 * PUT /api/files/:id
 */
filesApp.put('/:id', adminAuth, async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json().catch(() => ({}));
        
        const updateData = {};
        if (body.file_name) updateData.file_name = body.file_name;
        if (body.directory !== undefined) updateData.directory = body.directory;
        if (body.is_public !== undefined) updateData.is_public = body.is_public ? 1 : 0;

        if (Object.keys(updateData).length === 0) {
            return c.json({ code: 400, message: '未侦测到任何需要变更的可更新字段', error: {} }, 400);
        }

        const setClauses = Object.keys(updateData).map((k) => `${k} = ?`).join(', ');
        const setParams = Object.values(updateData);
        const { changes } = sqlite.prepare(
            `UPDATE files SET ${setClauses} WHERE id = ?`
        ).run(...setParams, id);

        if (!changes) {
            return c.json({ code: 404, message: '指定文件不存在或者其值未发生任何变动', error: {} }, 404);
        }

        return c.json({ code: 0, message: '文件部分信息更新已完成', data: { id, ...updateData } });
    } catch (err) {
        console.error('[Files API] 更新其部分属性意外结束:', err);
        return c.json({ code: 500, message: '修改信息失手，请联系服务维护者查找问题', error: err.message }, 500);
    }
});

/**
 * 执行硬删除销毁操作
 * DELETE /api/files/:id
 */
filesApp.delete('/:id', adminAuth, async (c) => {
    try {
        const id = c.req.param('id');
        const fileRecord = sqlite.prepare(
          'SELECT id, size, storage_key, storage_config, is_chunked FROM files WHERE id = ?'
        ).get(id);
        if (!fileRecord) {
             return c.json({ code: 404, message: '无需移除，该项目已从归档记录剔除', error: {} }, 200);
        }

        await deleteFileRecord(fileRecord, { db: sqlite, storageManager, ChunkManager });

        return c.json({ code: 0, message: '执行单体删除扫尾动作结束', data: { id } });
    } catch (err) {
        console.error('[Files API] 意外中断的 DELETE /:id', err);
        return c.json({ code: 500, message: '数据库执行软连接摧毁或者代理节点断联', error: err.message }, 500);
    }
});

/**
并发管理端点 (目前支持数组批处理删除及分类移动)
 * POST /api/files/batch
 */
filesApp.post('/batch', adminAuth, async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const response = await executeFilesBatchAction({
            action: body.action,
            ids: body.ids,
            targetDirectory: body.target_directory,
            targetChannel: body.target_channel,
            db: sqlite,
            storageManager,
            ChunkManager,
        });
        return c.json(response);
    } catch (err) {
        if (err.status) {
            return c.json({ code: err.status, message: err.message, error: {} }, err.status);
        }
        console.error('[Files API] 处理批处理流水线时崩溃:', err);
        return c.json({ code: 500, message: '并发堆栈遭遇滑铁卢：' + err.message, error: err.message }, 500);
    }
});

/**
 * 重建元数据
 * POST /api/files/maintenance/rebuild-metadata
 */
filesApp.post('/maintenance/rebuild-metadata', requirePermission('admin'), async (c) => {
    const force = c.req.query('force') === 'true';

    (async () => {
        try {
            await rebuildMetadataTask({
                force,
                db,
                storageManager,
            });
        } catch (err) {
            console.error('[Maintenance] 元数据重建任务崩溃:', err);
        }
    })();

    return c.json({
        code: 0,
        message: '元数据重建任务已在后台启动',
        data: { status: 'processing' }
    });
});

export default filesApp;
