const { Hono } = require('hono');
const { db } = require('../database');
const { adminAuth } = require('../middleware/auth');

const dirsApp = new Hono();

// 全部应用管控
dirsApp.use('*', adminAuth);

/**
 * 拼装安全物理路径辅助函数
 * @param {string|null} parentPath 父层路径
 * @param {string} rawName 基础名称
 */
const buildPath = (parentPath, rawName) => {
    // 防止不可见字符/非法路径穿越符合
    const safeName = rawName.replace(/[\/\\]/g, '').trim();
    if (!parentPath || parentPath === '/') {
        return `/${safeName}`;
    }
    return `${parentPath}/${safeName}`;
};

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

        let parentPath = '/';
        let parentIdToSave = null;

        if (parent_id) {
            const parent = await db.selectFrom('directories').selectAll().where('id', '=', parent_id).executeTakeFirst();
            if (!parent) {
                return c.json({ code: 404, message: '指定的父级目录不存在', error: {} }, 404);
            }
            parentPath = parent.path;
            parentIdToSave = parent.id;
        }

        const newPath = buildPath(parentPath, name);

        // 检查路径碰撞
        const exists = await db.selectFrom('directories').selectAll().where('path', '=', newPath).executeTakeFirst();
        if (exists) {
            return c.json({ code: 409, message: '该层级下同名目录已存在', error: {} }, 409);
        }

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
        const { name } = body; // 当前暂时只支持同级改名。由于改 path 牵一发动全身（树下所有文件、子文件统统需要更新），建议拆分实现

        if (!name || name.trim() === '') {
             return c.json({ code: 400, message: '未提供有效的新名称', error: {} }, 400);
        }

        // 1. 获取目标原态
        const targetDir = await db.selectFrom('directories').selectAll().where('id', '=', id).executeTakeFirst();
        if (!targetDir) {
            return c.json({ code: 404, message: '修改对象不存在', error: {} }, 404);
        }

        const oldPath = targetDir.path;
        
        let parentPath = '/';
        if (targetDir.parent_id) {
             const parent = await db.selectFrom('directories').selectAll().where('id', '=', targetDir.parent_id).executeTakeFirst();
             if (parent) parentPath = parent.path;
        }

        const newPath = buildPath(parentPath, name);

        // 2. 检查碰撞
        if (oldPath !== newPath) {
             const exist = await db.selectFrom('directories').select('id').where('path', '=', newPath).executeTakeFirst();
             if (exist) return c.json({ code: 409, message: '该级别已存在此同名目录', error: {} }, 409);
        }

        // 3. 执行 Kysely 层面的数据变更
        // 难点在于所有 files 内挂接在此处的图片，都需要做 `directory = ?` 修正；以及以其为 parent 的级联 path 修正。
        // 这里提供简单版的 name 更新实现，和 `files` 表单层平级更新！
        await db.updateTable('directories')
            .set({ name: name.trim(), path: newPath })
            .where('id', '=', id)
            .execute();

        if (oldPath !== newPath) {
             // 简单处理直接关联它的 files 修正
             await db.updateTable('files')
                .set({ directory: newPath })
                .where('directory', '=', oldPath)
                .execute();
             
             // 如果要处理子目录... SQLite 对于 update replace 较弱，可以通过 Node 取出所有子目录循环更新
             const children = await db.selectFrom('directories').selectAll().where('path', 'like', `${oldPath}/%`).execute();
             for (const child of children) {
                 const updatedChildPath = child.path.replace(oldPath, newPath);
                 await db.updateTable('directories').set({ path: updatedChildPath }).where('id', '=', child.id).execute();
                 await db.updateTable('files').set({ directory: updatedChildPath }).where('directory', '=', child.path).execute();
             }
        }

        return c.json({ code: 0, message: '变更已应用', data: { id, name: name.trim(), path: newPath } });
    } catch (err) {
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
