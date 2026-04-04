const { Hono } = require('hono');
const { db } = require('../database');
const { adminAuth } = require('../middleware/auth');
const { resolveParentPath, checkPathConflict, buildPath, renameDirectory } = require('../services/directories/directory-operations');

const dirsApp = new Hono();

// 全部应用管控
dirsApp.use('*', adminAuth);

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
dirsApp.get('/', async (c) => {
    try {
        const type = c.req.query('type'); // 若 type=flat 则返回平层数组，否则默认树形
        const dirs = await db.selectFrom('directories').selectAll().orderBy('path', 'asc').execute();
        
        if (type === 'flat') {
            return c.json({ code: 0, message: 'success', data: dirs });
        }
        
        const tree = buildTree(dirs, null);
        return c.json({ code: 0, message: 'success', data: tree });
    } catch (err) {
        return c.json({ code: 500, message: '获取目录树失败', error: err.message }, 500);
    }
});

/**
 * 创建新目录
 * POST /api/directories
 */
dirsApp.post('/', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const { name, parent_id } = body;

        if (!name || name.trim() === '') {
            return c.json({ code: 400, message: '目录名称不能为空', error: {} }, 400);
        }

        const { parentPath, parentIdToSave } = await resolveParentPath(parent_id, db);
        const newPath = buildPath(parentPath, name);

        await checkPathConflict(newPath, db);

        const inserted = await db.insertInto('directories')
            .values({
                name: name.trim(),
                path: newPath,
                parent_id: parentIdToSave
            })
            .returningAll()
            .executeTakeFirst();

        return c.json({ code: 0, message: '创建成功', data: inserted });
    } catch (err) {
        if (err.status) {
            return c.json({ code: err.status, message: err.message, error: {} }, err.status);
        }
        return c.json({ code: 500, message: '创建目录失败', error: err.message }, 500);
    }
});

/**
 * 修改目录
 * PUT /api/directories/:id
 */
dirsApp.put('/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        if (isNaN(id)) return c.json({ code: 400, message: '无效的 ID 格式', error: {} }, 400);

        const body = await c.req.json().catch(() => ({}));
        const { name } = body;

        if (!name || name.trim() === '') {
             return c.json({ code: 400, message: '未提供有效的新名称', error: {} }, 400);
        }

        const result = await renameDirectory(id, name, db);
        return c.json({ code: 0, message: '变更已应用', data: result });
    } catch (err) {
        if (err.status) {
            return c.json({ code: err.status, message: err.message, error: {} }, err.status);
        }
        console.error('[Directories] PUT error:', err);
        return c.json({ code: 500, message: '变动发生运行时奔溃', error: err.message }, 500);
    }
});

/**
 * 删除目录
 * DELETE /api/directories/:id
 */
dirsApp.delete('/:id', async (c) => {
    try {
        const id = Number(c.req.param('id'));
        if (isNaN(id)) return c.json({ code: 400, message: '无效的 ID 格式', error: {} }, 400);

        const targetDir = await db.selectFrom('directories').selectAll().where('id', '=', id).executeTakeFirst();
        if (!targetDir) {
           return c.json({ code: 0, message: '目录已无存' });
        }

        // 检测此目录下是否还有文件残留
        const fileCountRes = await db.selectFrom('files').select(db.fn.count('id').as('ct')).where('directory', 'like', `${targetDir.path}%`).executeTakeFirst();
        const ct = Number(fileCountRes.ct);
        if (ct > 0) {
            return c.json({ code: 403, message: `无法剔除：该逻辑目录或其子孙集下仍关联有 ${ct} 份文件未清除或转移`, error: {} }, 403);
        }

        // 检测是否还有子文件夹挂载
        const childDirsRes = await db.selectFrom('directories').select(db.fn.count('id').as('ct')).where('parent_id', '=', id).executeTakeFirst();
        if (Number(childDirsRes.ct) > 0) {
            return c.json({ code: 403, message: '存在子目录，请优先自下而上清空子节点层', error: {} }, 403);
        }

        await db.deleteFrom('directories').where('id', '=', id).execute();
        
        return c.json({ code: 0, message: '安全移除完成', data: {} });
    } catch(err) {
        console.error('[Directories] DELETE error:', err);
        return c.json({ code: 500, message: '系统级异常', error: err.message }, 500);
    }
});

module.exports = dirsApp;
