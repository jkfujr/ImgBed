const { Hono } = require('hono');
const { db } = require('../database');
const sharp = require('sharp');
const { adminAuth, requirePermission } = require('../middleware/auth');
const storageManager = require('../storage/manager');

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
        let query = db.selectFrom('files').select([
            'id', 'file_name', 'original_name', 'mime_type', 'size',
            'storage_channel', 'storage_key', 'storage_config',
            'upload_ip', 'upload_address', 'created_at', 'updated_at',
            'directory', 'tags', 'is_public',
            'width', 'height', 'uploader_type', 'uploader_id'
        ]);
        let countQuery = db.selectFrom('files').select(db.fn.count('id').as('total'));

        // 拼接查询属性
        if (directory) {
            query = query.where('directory', '=', directory);
            countQuery = countQuery.where('directory', '=', directory);
        }

        if (search) {
            const keyword = `%${search}%`;
            query = query.where('file_name', 'like', keyword);
            countQuery = countQuery.where('file_name', 'like', keyword);
        }

        // 排序与分页截断
        const offset = (page - 1) * pageSize;
        const [list, countResult] = await Promise.all([
            query.orderBy('created_at', 'desc').limit(pageSize).offset(offset).execute(),
            countQuery.executeTakeFirst()
        ]);

        const total = Number(countResult.total);
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
        const file = await db.selectFrom('files').selectAll().where('id', '=', id).executeTakeFirst();
        
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

        const result = await db.updateTable('files')
            .set(updateData)
            .where('id', '=', id)
            .executeTakeFirst();

        // 根据 Kysely 的更新结果断言 (numUpdatedRows 依赖不同驱动的行为，但正常均存在)
        if (result.numUpdatedRows === 0n || result.numUpdatedRows === 0) {
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
        
        // 核心步1：先查明身份，解析 JSON 取出映射所依赖的 instanceId
        const fileRecord = await db.selectFrom('files').select(['size', 'storage_key', 'storage_config']).where('id', '=', id).executeTakeFirst();
        if (!fileRecord) {
             return c.json({ code: 404, message: '无需移除，该项目已从归档记录剔除', error: {} }, 200);
        }

        // 核心步2: 尝试向渠道网关同步触发销毁物理存储
        // *提示: 云端只读接口或外部反代渠道的底层报错通常会被忽略*
        let configObj = {};
        try { configObj = JSON.parse(fileRecord.storage_config || '{}'); } catch(e){}
        const instanceId = configObj.instance_id;

        if (instanceId) {
             const storage = storageManager.getStorage(instanceId);
             if (storage) {
                 await storage.delete(fileRecord.storage_key).catch(e => {
                     console.warn(`[Files API] 底层存储提供方远程删除失败 (忽略并继续清理引用): `, e.message);
                 });
             }
             // 增量更新容量缓存：减去文件大小
             const fileSize = Number(fileRecord.size) || 0;
             if (fileSize > 0) {
                 storageManager.updateQuotaCache(instanceId, -fileSize);
             }
        }

        // 核心步3: 销毁 SQLite SQL 层面的记录数据
        await db.deleteFrom('files').where('id', '=', id).execute();

        // 记录删除到使用统计并更新容量缓存
        if (instanceId) {
            storageManager.recordDelete(instanceId);
            const fileSize = Number(fileRecord.size) || 0;
            if (fileSize > 0) {
                storageManager.updateQuotaCache(instanceId, -fileSize);
            }
        }

        return c.json({ code: 0, message: '执行单体删除扫尾动作结束', data: { id } });
    } catch (err) {
        console.error('[Files API] 意外中断的 DELETE /:id', err);
        return c.json({ code: 500, message: '数据库执行软连接摧毁或者代理节点断联', error: err.message }, 500);
    }
});

/**
 * 大量并发管理端点 (目前支持数组批处理删除及分类移动)
 * POST /api/files/batch
 */
filesApp.post('/batch', adminAuth, async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const { action, ids, target_directory } = body;

        // 对输入的 ids 包作断言
        if (!Array.isArray(ids) || ids.length === 0) {
            return c.json({ code: 400, message: '未附带任何将要施加作用的主键 [ids] 表', error: {} }, 400);
        }

        // 删除批处理
        if (action === 'delete') {
            const files = await db.selectFrom('files').selectAll().where('id', 'in', ids).execute();
            let deletedCount = 0;
            
            for (const fileRecord of files) {
                let configObj = {};
                try { configObj = JSON.parse(fileRecord.storage_config || '{}'); } catch(e){}
                const instanceId = configObj.instance_id;
                const storage = storageManager.getStorage(instanceId);
                // 逐笔执行物理销毁
                if (storage) {
                    await storage.delete(fileRecord.storage_key).catch(() => {});
                }
                // 增量更新容量缓存：减去文件大小
                if (instanceId) {
                    const fileSize = Number(fileRecord.size) || 0;
                    if (fileSize > 0) {
                        storageManager.updateQuotaCache(instanceId, -fileSize);
                    }
                }
                // 从当前库中移除此图
                await db.deleteFrom('files').where('id', '=', fileRecord.id).execute();
                // 记录删除统计
                if (instanceId) storageManager.recordDelete(instanceId);
                deletedCount++;
            }
            return c.json({ code: 0, message: `完毕，已成功清除 ${deletedCount} 份上传档案`, data: { deleted: deletedCount }});

        // 转移目录批处理
        } else if (action === 'move') {
            if (target_directory === undefined) {
                return c.json({ code: 400, message: '执行移动批处理时，必须连通带有目标目录 (target_directory) 指针', error: {} }, 400);
            }
            await db.updateTable('files')
                .set({ directory: target_directory })
                .where('id', 'in', ids)
                .execute();

            return c.json({ code: 0, message: `移库完成，已将 ${ids.length} 宗物品改签至 ${target_directory}`, data: {} });

        // 迁移存储渠道批处理
        } else if (action === 'migrate') {
            const { target_channel } = body;

            // 参数校验
            if (!target_channel) {
                return c.json({ code: 400, message: '迁移操作必须指定 target_channel（目标渠道ID）', error: {} }, 400);
            }

            // 验证目标渠道是否存在且启用
            const targetEntry = storageManager.instances.get(target_channel);
            if (!targetEntry) {
                return c.json({ code: 404, message: `目标渠道不存在: ${target_channel}`, error: {} }, 404);
            }

            // 验证目标渠道是否支持写入（只有 local/s3/huggingface 支持 put）
            if (!storageManager.isUploadAllowed(target_channel)) {
                return c.json({ code: 403, message: `目标渠道不支持写入: ${target_channel}`, error: {} }, 403);
            }

            // 验证目标渠道类型是否可写入（排除 telegram/discord/external）
            if (!['local', 's3', 'huggingface'].includes(targetEntry.type)) {
                return c.json({ code: 403, message: `目标渠道类型 ${targetEntry.type} 不支持作为迁移目标`, error: {} }, 403);
            }

            // 获取所有待迁移文件记录
            const files = await db.selectFrom('files')
                .selectAll()
                .where('id', 'in', ids)
                .execute();

            // 迁移结果统计
            const results = {
                total: files.length,
                success: 0,
                failed: 0,
                skipped: 0,
                errors: []
            };

            const targetStorage = targetEntry.instance;

            // 逐文件迁移
            for (const fileRecord of files) {
                try {
                    // 解析源渠道配置
                    let sourceConfig = {};
                    try { sourceConfig = JSON.parse(fileRecord.storage_config || '{}'); } catch (e) {}
                    const sourceInstanceId = sourceConfig.instance_id;

                    // 跳过：源渠道和目标渠道相同
                    if (sourceInstanceId === target_channel) {
                        results.skipped++;
                        continue;
                    }

                    // 获取源渠道实例
                    const sourceEntry = storageManager.instances.get(sourceInstanceId);
                    if (!sourceEntry) {
                        results.failed++;
                        results.errors.push({ id: fileRecord.id, reason: '源渠道不存在' });
                        continue;
                    }

                    const sourceStorage = sourceEntry.instance;

                    // 步骤1：从源渠道下载文件流
                    const fileStream = await sourceStorage.getStream(fileRecord.storage_key);

                    // 步骤2：将流转为 Buffer（适配 put 接口）
                    const chunks = [];
                    for await (const chunk of fileStream) {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    }
                    const fileBuffer = Buffer.concat(chunks);

                    // 步骤3：上传到目标渠道
                    const uploadResult = await targetStorage.put(fileBuffer, {
                        id: fileRecord.id,
                        fileName: fileRecord.file_name,
                        originalName: fileRecord.original_name,
                        mimeType: fileRecord.mime_type
                    });

                    // 步骤4：更新数据库记录
                    await db.updateTable('files')
                        .set({
                            storage_channel: targetEntry.type,
                            storage_key: uploadResult.id || fileRecord.storage_key,
                            storage_config: JSON.stringify({
                                instance_id: target_channel,
                                extra_result: uploadResult
                            })
                        })
                        .where('id', '=', fileRecord.id)
                        .execute();

                    // 步骤5：迁移成功后，更新容量缓存：原渠道减少，新渠道增加
                    try {
                        const oldConfig = JSON.parse(fileRecord.storage_config || '{}');
                        const oldInstanceId = oldConfig.instance_id;
                        const fileSize = Number(fileRecord.size) || 0;

                        if (oldInstanceId) {
                            storageManager.updateQuotaCache(oldInstanceId, -fileSize);
                        }
                        storageManager.updateQuotaCache(target_channel, fileSize);
                    } catch (e) {
                        console.error('[Files API] 迁移后更新容量缓存失败:', e.message);
                    }

                    results.success++;

                } catch (err) {
                    console.error(`[Files API] 迁移文件 ${fileRecord.id} 失败:`, err.message);
                    results.failed++;
                    results.errors.push({ id: fileRecord.id, reason: err.message });
                    // 迁移失败时不删除源文件，保持数据安全
                }
            }

            return c.json({
                code: 0,
                message: `迁移完成：成功 ${results.success}，失败 ${results.failed}，跳过 ${results.skipped}`,
                data: results
            });

        } else {
             return c.json({ code: 400, message: '暂不允许执行此处未作解析约定的行为指令(仅支持 delete/move/migrate)', error: {} }, 400);
        }
    } catch (err) {
        console.error('[Files API] 处理批处理流水线时崩溃:', err);
        return c.json({ code: 500, message: '并发堆栈遭遇滑铁卢：' + err.message, error: err.message }, 500);
    }
});

/**
 * 维护接口：重建图片元数据（宽高、EXIF）
 * POST /api/files/maintenance/rebuild-metadata
 */
filesApp.post('/maintenance/rebuild-metadata', requirePermission('admin'), async (c) => {
    const force = c.req.query('force') === 'true'; // 是否强制重新扫描所有文件

    // 启动异步处理，不阻塞 HTTP 响应
    (async () => {
        console.log(`[Maintenance] 开始${force ? '全量' : '增量'}重建元数据...`);
        try {
            let query = db.selectFrom('files').selectAll().where('mime_type', 'like', 'image/%');
            if (!force) {
                query = query.where('width', 'is', null);
            }

            const files = await query.execute();
            console.log(`[Maintenance] 找到 ${files.length} 个待处理文件`);

            for (const file of files) {
                try {
                    let storageId = file.storage_channel;

                    // 修复：如果存储在数据库中记录的是存储类型(如 'local')，尝试解析出实际的实例 ID
                    if (file.storage_config) {
                        try {
                            const cfg = JSON.parse(file.storage_config);
                            if (cfg.instance_id) {
                                storageId = cfg.instance_id;
                            }
                        } catch (e) {}
                    }

                    const storage = storageManager.getStorage(storageId);
                    if (!storage) {
                        console.warn(`[Maintenance] 找不到存储实例: ${storageId} (File: ${file.id})`);
                        continue;
                    }

                    const stream = await storage.getStream(file.storage_key || file.id);
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    const buffer = Buffer.concat(chunks);

                    if (!buffer || buffer.length === 0) {
                        console.warn(`[Maintenance] 文件内容为空: ${file.id}`);
                        continue;
                    }

                    const metadata = await sharp(buffer).metadata();
                    const { format, size, width, height, space, channels, depth, density, hasProfile, hasAlpha, orientation, exif: rawExif } = metadata;
                    const exifData = JSON.stringify({ format, size, width, height, space, channels, depth, density, hasProfile, hasAlpha, orientation, hasExif: !!rawExif });

                    await db.updateTable('files')
                        .set({
                            width: width || null,
                            height: height || null,
                            exif: exifData
                        })
                        .where('id', '=', file.id)
                        .execute();

                    // 适当休眠避免 IO 压力过大
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (err) {
                    console.error(`[Maintenance] 处理文件 ${file.id} 失败:`, err.message);
                }
            }
            console.log('[Maintenance] 元数据重建任务完成');
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

module.exports = filesApp;
