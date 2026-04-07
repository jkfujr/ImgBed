import express from 'express';
import { sqlite } from '../database/index.js';
import { adminAuth } from '../middleware/auth.js';
import { resolveParentPath, checkPathConflict, buildPath, renameDirectory } from '../services/directories/directory-operations.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { ValidationError, ForbiddenError } from '../errors/AppError.js';
import { success } from '../utils/response.js';

const dirsApp = express.Router();

dirsApp.use(adminAuth);

const buildTree = (directories, parentId = null) => {
    return directories
        .filter(dir => dir.parent_id === parentId)
        .map(dir => ({
            ...dir,
            children: buildTree(directories, dir.id)
        }));
};

/**
 * 获取目录树
 * GET /api/directories
 */
dirsApp.get('/', asyncHandler(async (req, res) => {
    const type = req.query.type;
    const dirs = sqlite.prepare('SELECT * FROM directories ORDER BY path ASC').all();

    if (type === 'flat') {
        return res.json(success(dirs));
    }

    const tree = buildTree(dirs, null);
    return res.json(success(tree));
}));

/**
 * 创建新目录
 * POST /api/directories
 */
dirsApp.post('/', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const { name, parent_id } = body;

    if (!name || name.trim() === '') {
        throw new ValidationError('目录名称不能为空');
    }

    const { parentPath, parentIdToSave } = await resolveParentPath(parent_id, sqlite);
    const newPath = buildPath(parentPath, name);

    await checkPathConflict(newPath, sqlite);

    const insertRes = sqlite.prepare(
        'INSERT INTO directories (name, path, parent_id) VALUES (?, ?, ?)'
    ).run(name.trim(), newPath, parentIdToSave);

    const inserted = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(Number(insertRes.lastInsertRowid));

    return res.json(success(inserted, '创建成功'));
}));

/**
 * 修改目录
 * PUT /api/directories/:id
 */
dirsApp.put('/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
        throw new ValidationError('无效的 ID 格式');
    }

    const body = req.body || {};
    const { name } = body;

    if (!name || name.trim() === '') {
        throw new ValidationError('未提供有效的新名称');
    }

    const result = await renameDirectory(id, name, sqlite);
    return res.json(success(result, '变更已应用'));
}));

/**
 * 删除目录
 * DELETE /api/directories/:id
 */
dirsApp.delete('/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
        throw new ValidationError('无效的 ID 格式');
    }

    const targetDir = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(id);
    if (!targetDir) {
       return res.json(success(null, '目录已不存在'));
    }

    const fileCountRes = sqlite.prepare('SELECT COUNT(id) AS ct FROM files WHERE directory LIKE ?').get(`${targetDir.path}%`);
    const ct = Number(fileCountRes?.ct || 0);
    if (ct > 0) {
        throw new ForbiddenError(`无法删除：该目录或其子目录下仍关联 ${ct} 份文件`);
    }

    const childDirsRes = sqlite.prepare('SELECT COUNT(id) AS ct FROM directories WHERE parent_id = ?').get(id);
    if (Number(childDirsRes?.ct || 0) > 0) {
        throw new ForbiddenError('存在子目录，请先清空子目录');
    }

    sqlite.prepare('DELETE FROM directories WHERE id = ?').run(id);

    return res.json(success({}, '目录删除完成'));
}));

export default dirsApp;
