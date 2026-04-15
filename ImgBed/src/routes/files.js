import express from 'express';
import { sqlite } from '../database/index.js';
import { getActiveFileById } from '../database/files-dao.js';
import { adminAuth, requirePermission } from '../middleware/auth.js';
import storageManager from '../storage/manager.js';
import { deleteFileRecord } from '../services/files/delete-file.js';
import { executeFilesBatchAction } from '../services/files/batch-action.js';
import { rebuildMetadataTask } from '../services/files/rebuild-metadata.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { createLogger } from '../utils/logger.js';
import { filesListCache, cacheInvalidation } from '../middleware/cache.js';
import { success } from '../utils/response.js';
import { ensureExistingDirectoryPath, normalizeDirectoryPath, parseOptionalDirectoryPath } from '../utils/directory-path.js';

const log = createLogger('files');
const filesApp = express.Router();

function validatePaging(page, pageSize) {
    if (!Number.isInteger(page) || page < 1) {
        throw new ValidationError('page 参数必须是大于等于 1 的整数');
    }

    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new ValidationError('pageSize 参数必须是大于等于 1 的整数');
    }
}

function normalizeDirectoryOrThrow(input, fieldLabel = 'directory') {
    try {
        return normalizeDirectoryPath(input);
    } catch (error) {
        throw new ValidationError(`${fieldLabel} 参数不合法：${error.message}`);
    }
}

function parseOptionalDirectoryOrThrow(input, fieldLabel = 'directory') {
    try {
        return parseOptionalDirectoryPath(input);
    } catch (error) {
        throw new ValidationError(`${fieldLabel} 参数不合法：${error.message}`);
    }
}

function ensureDirectoryExistsOrThrow(directory, fieldLabel = 'directory') {
    try {
        ensureExistingDirectoryPath(directory, sqlite);
    } catch (error) {
        throw new ValidationError(`${fieldLabel} 参数不合法：${error.message}`);
    }
}

/**
 * 文件列表接口 (带分页与简单过滤)
 * GET /api/files
 */
filesApp.get('/', requirePermission('files:read'), filesListCache(), asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page || '1');
    const pageSize = parseInt(req.query.pageSize || '20');
    const directory = parseOptionalDirectoryOrThrow(req.query.directory);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    validatePaging(page, pageSize);

    const isSearchMode = search.length > 0;
    if (!isSearchMode && directory === undefined) {
        throw new ValidationError('浏览文件列表时必须提供 directory 参数');
    }

    if (directory !== undefined) {
        ensureDirectoryExistsOrThrow(directory);
    }

    const conditions = ['status = ?'];
    const params = ['active'];

    if (directory !== undefined) {
        conditions.push('directory = ?');
        params.push(directory);
    }

    if (isSearchMode) {
        conditions.push('file_name LIKE ?');
        params.push(`%${search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const listStmt = sqlite.prepare(
        `SELECT id, file_name, original_name, mime_type, size,
                storage_channel, storage_key, storage_meta, storage_instance_id,
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

    return res.json(success({
        list,
        pagination: {
            page,
            pageSize,
            total,
            totalPages
        }
    }));
}));

/**
 * 获取文件详细信息
 * GET /api/files/:id
 */
filesApp.get('/:id', requirePermission('files:read'), asyncHandler(async (req, res) => {
    const id = req.params.id;
    const file = getActiveFileById(sqlite, id);

    if (!file) {
        throw new NotFoundError('指定的文件未找到');
    }

    return res.json(success(file));
}));

/**
 * 修改文件属性名称或改变所处逻辑目录
 * PUT /api/files/:id
 */
filesApp.put('/:id', adminAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};

    const updateData = {};
    if (body.file_name) updateData.file_name = body.file_name;
    if (body.directory !== undefined) {
        const normalizedDirectory = normalizeDirectoryOrThrow(body.directory);
        ensureDirectoryExistsOrThrow(normalizedDirectory);
        updateData.directory = normalizedDirectory;
    }
    if (body.is_public !== undefined) updateData.is_public = body.is_public ? 1 : 0;

    if (Object.keys(updateData).length === 0) {
        throw new ValidationError('未检测到任何需要变更的可更新字段');
    }

    const setClauses = Object.keys(updateData).map((k) => `${k} = ?`).join(', ');
    const setParams = Object.values(updateData);
    const { changes } = sqlite.prepare(
        `UPDATE files SET ${setClauses} WHERE id = ? AND status = 'active'`
    ).run(...setParams, id);

    if (!changes) {
        throw new NotFoundError('指定文件不存在或其值未发生变动');
    }

    // 使文件列表缓存失效
    cacheInvalidation.invalidateFiles();

    return res.json(success({ id, ...updateData }, '文件信息更新已完成'));
}));

/**
 * 执行硬删除销毁操作
 * DELETE /api/files/:id
 * Query/Delete mode: delete_mode=remote_and_index（默认）| index_only
 */
filesApp.delete('/:id', adminAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const deleteMode = req.query.delete_mode || req.body?.delete_mode || 'remote_and_index';
    const fileRecord = getActiveFileById(sqlite, id);
    if (!fileRecord) {
        throw new NotFoundError('文件不存在或已被删除');
    }

    await deleteFileRecord(fileRecord, { db: sqlite, storageManager, deleteMode });

    // 使文件列表缓存失效
    cacheInvalidation.invalidateFiles();

    return res.json(success({ id }, '文件删除成功'));
}));

/**
 * 并发管理端点 (批处理删除及分类移动)
 * POST /api/files/batch
 */
filesApp.post('/batch', adminAuth, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const response = await executeFilesBatchAction({
        action: body.action,
        ids: body.ids,
        targetDirectory: body.target_directory,
        targetChannel: body.target_channel,
        deleteMode: body.delete_mode || 'remote_and_index',
        db: sqlite,
        storageManager,
    });

    // 使文件列表缓存失效
    cacheInvalidation.invalidateFiles();

    return res.json(response);
}));

/**
 * 重建元数据
 * POST /api/files/maintenance/rebuild-metadata
 */
filesApp.post('/maintenance/rebuild-metadata', requirePermission('admin'), asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';

    (async () => {
        try {
            await rebuildMetadataTask({
                force,
                db: sqlite,
                storageManager,
            });
        } catch (err) {
            log.error({ err }, '元数据重建任务崩溃');
        }
    })();

    return res.json(success({ status: 'processing' }, '元数据重建任务已在后台启动'));
}));

export default filesApp;
