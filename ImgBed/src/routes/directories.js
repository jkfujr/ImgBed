import express from 'express';
import { sqlite } from '../database/index.js';
import { adminAuth } from '../middleware/auth.js';
import { resolveParentPath, checkPathConflict, buildPath, renameDirectory } from '../services/directories/directory-operations.js';

const dirsApp = express.Router();

// 全部应用管控
dirsApp.use(adminAuth);

/**
 * 递归组装树结构辅助函数
 */
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
dirsApp.get('/', async (req, res) => {
    try {
        const type = req.query.type; // 若 type=flat 则返回平层数组，否则默认树形
        const dirs = sqlite.prepare('SELECT * FROM directories ORDER BY path ASC').all();
        
        if (type === 'flat') {
            return res.json({ code: 0, message: 'success', data: dirs });
        }
        
        const tree = buildTree(dirs, null);
        return res.json({ code: 0, message: 'success', data: tree });
    } catch (err) {
        return res.status(500).json({ code: 500, message: '获取目录树失败', error: err.message });
    }
});

/**
 * 创建新目录
 * POST /api/directories
 */
dirsApp.post('/', async (req, res) => {
    try {
        const body = req.body || {};
        const { name, parent_id } = body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ code: 400, message: '目录名称不能为空', error: {} });
        }

        const { parentPath, parentIdToSave } = await resolveParentPath(parent_id, sqlite);
        const newPath = buildPath(parentPath, name);

        await checkPathConflict(newPath, sqlite);

        const insertRes = sqlite.prepare(
            'INSERT INTO directories (name, path, parent_id) VALUES (?, ?, ?)' 
        ).run(name.trim(), newPath, parentIdToSave);

        const inserted = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(Number(insertRes.lastInsertRowid));

        return res.json({ code: 0, message: '创建成功', data: inserted });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ code: err.status, message: err.message, error: {} });
        }
        return res.status(500).json({ code: 500, message: '创建目录失败', error: err.message });
    }
});

/**
 * 修改目录
 * PUT /api/directories/:id
 */
dirsApp.put('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ code: 400, message: '无效的 ID 格式', error: {} });

        const body = req.body || {};
        const { name } = body;

        if (!name || name.trim() === '') {
             return res.status(400).json({ code: 400, message: '未提供有效的新名称', error: {} });
        }

        const result = await renameDirectory(id, name, sqlite);
        return res.json({ code: 0, message: '变更已应用', data: result });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ code: err.status, message: err.message, error: {} });
        }
        console.error('[Directories] PUT error:', err);
        return res.status(500).json({ code: 500, message: '变动发生运行时奔溃', error: err.message });
    }
});

/**
 * 删除目录
 * DELETE /api/directories/:id
 */
dirsApp.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ code: 400, message: '无效的 ID 格式', error: {} });

        const targetDir = sqlite.prepare('SELECT * FROM directories WHERE id = ?').get(id);
        if (!targetDir) {
           return res.json({ code: 0, message: '目录已无存' });
        }

        // 检测此目录下是否还有文件残留
        const fileCountRes = sqlite.prepare('SELECT COUNT(id) AS ct FROM files WHERE directory LIKE ?').get(`${targetDir.path}%`);
        const ct = Number(fileCountRes?.ct || 0);
        if (ct > 0) {
            return res.status(403).json({ code: 403, message: `无法剔除：该逻辑目录或其子孙集下仍关联有 ${ct} 份文件未清除或转移`, error: {} });
        }

        // 检测是否还有子文件夹挂载
        const childDirsRes = sqlite.prepare('SELECT COUNT(id) AS ct FROM directories WHERE parent_id = ?').get(id);
        if (Number(childDirsRes?.ct || 0) > 0) {
            return res.status(403).json({ code: 403, message: '存在子目录，请优先自下而上清空子节点层', error: {} });
        }

        sqlite.prepare('DELETE FROM directories WHERE id = ?').run(id);
        
        return res.json({ code: 0, message: '安全移除完成', data: {} });
    } catch(err) {
        console.error('[Directories] DELETE error:', err);
        return res.status(500).json({ code: 500, message: '系统级异常', error: err.message });
    }
});

export default dirsApp;
