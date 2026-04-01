const { Hono } = require('hono');
const crypto = require('crypto');
const storageManager = require('../storage/manager');
const { db } = require('../database');
const { requirePermission } = require('../middleware/auth');
const config = require('../config');
const path = require('path');

const uploadApp = new Hono();

// 获取毫秒级时间戳混合随机码的简易ID生成器
const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
};

/**
 * 文件上传接口
 * POST /api/upload
 * （可选择是否需要 adminAuth。根据需求目前加上管理员拦截。若作为公共图床，后续可配置为宽松模式）
 */
uploadApp.post('/', requirePermission('upload:image'), async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file']; // 从 FormData 解析 "file" 字段

    if (!file || typeof file === 'string') {
      return c.json({ code: 400, message: '未检测到文件上传或字段错误', error: {} }, 400);
    }
    
    // 大小超限检测
    const maxSize = config.security?.maxFileSize || 100 * 1024 * 1024; // 默认 100MB
    if (file.size > maxSize) {
       return c.json({ code: 413, message: '文件体积超出服务器限制', error: {} }, 413);
    }

    // 确定存储渠道实例（优先级：用户指定 > 负载均衡策略 > 默认渠道）
    let channelId = body['channel'];
    if (!channelId) {
        const strategy = config.storage?.loadBalanceStrategy || 'default';
        if (strategy !== 'default') {
            const preferredType = body['preferredType'] || null;
            channelId = storageManager.selectUploadChannel(preferredType);
        }
        if (!channelId) {
            channelId = storageManager.getDefaultStorageId();
        }
    }
    if (!channelId) {
      return c.json({ code: 500, message: '服务端未指定任何默认存储渠道', error: {} }, 500);
    }

    // 验证渠道是否合法启用并且具有写入权限
    const storage = storageManager.getStorage(channelId);
    if (!storage) {
       return c.json({ code: 400, message: `找不到指定的存储渠道: ${channelId}`, error: {} }, 400);
    }

    // 根据检查模式进行容量检查
    // auto 模式：直接使用内存缓存，极快
    // always 模式：每次上传全量统计数据库
    let quotaAllowed = true;
    const checkMode = config.upload?.quotaCheckMode || 'auto';

    if (checkMode === 'always') {
      // always 模式：全量统计该渠道容量
      try {
        const result = await db
          .selectFrom('files')
          .select(['size', 'storage_config'])
          .execute();

        let totalBytes = 0;
        for (const row of result) {
          let cfg;
          try {
            cfg = JSON.parse(row.storage_config || '{}');
            if (cfg.instance_id === channelId) {
              totalBytes += Number(row.size) || 0;
            }
          } catch (e) {}
        }

        // 检查是否超限
        if (storageManager.isQuotaExceeded(channelId, totalBytes)) {
          quotaAllowed = false;
        }
      } catch (err) {
        console.warn('[Upload] 容量检查失败，继续上传:', err.message);
        // 如果统计失败，出于容错考虑仍然允许上传
      }
    } else {
      // auto 模式：直接使用缓存检查
      if (!storageManager.isUploadAllowed(channelId)) {
        quotaAllowed = false;
      }
    }

    if (!quotaAllowed) {
      return c.json({ code: 403, message: `渠道 [${channelId}] 容量已达到停用阈值，已关闭上传功能`, error: {} }, 403);
    }

    // 生成唯一文件ID (哈希 + 清理后的原名 + 后缀)
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash('sha1').update(buffer).digest('hex').substring(0, 12);
    
    const originalName = file.name || 'blob';
    const rawExt = path.extname(originalName).toLowerCase();
    // 针对冗余的 jpeg 做标准化为 jpg
    const mimeExt = file.type ? `.${file.type.split('/')[1]}`.replace('.jpeg', '.jpg') : '';
    const extension = rawExt || mimeExt || '';

    // --- 增加文件类型过滤：仅允许图片 ---
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    const isImageMime = file.type && file.type.startsWith('image/');
    const isImageExt = allowedExtensions.includes(extension.toLowerCase());

    if (!isImageMime || !isImageExt) {
        return c.json({ 
            code: 400, 
            message: `非法文件格式: ${file.type || '未知'} (${extension || '无后缀'})。本站仅支持图片托管。`, 
            error: {} 
        }, 400);
    }
    // --- 过滤结束 ---
    
    // 清理原始文件名中的不安全字符 (仅保留字母数字，其余转为下划线，限制长度)
    const baseNameOnly = originalName.replace(/\.[^/.]+$/, ""); 
    const safeBaseName = baseNameOnly.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 24);
    
    // 最终唯一 ID: 哈希_原名.后缀
    const fileId = `${hash}_${safeBaseName || 'file'}${extension}`;
    const newFileName = fileId; 
    
    // 执行底层物理存储
    let storageResult;
    try {
        storageResult = await storage.put(file, {
            id: fileId,
            fileName: newFileName,
            originalName: originalName,
            mimeType: file.type || 'application/octet-stream' 
        });
    } catch(err) {
        console.error(`[Upload] 向底层存储渠道抛掷时发生错误:`, err);
        throw new Error("底层文件流转储失败: " + err.message);
    }

    const auth = c.get('auth');
    const uploaderType = auth?.type || 'admin_jwt';
    const uploaderId = auth?.tokenId || auth?.username || 'admin';

    // 处理客户端环境信息
    const clientIp = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';

    // 生成存入数据库的模型数据
    const dbRecord = {
        id: String(fileId),
        file_name: String(newFileName),
        original_name: String(originalName),
        mime_type: String(file.type || 'application/octet-stream'),
        size: Number(file.size),
        
        // Storage binding
        storage_channel: String(storageManager.instances.get(channelId)?.type || 'unknown'), 
        storage_key: String(storageResult.id || newFileName), 
        storage_config: JSON.stringify({
            instance_id: channelId, 
            extra_result: storageResult 
        }),
        
        // 环境信息
        upload_ip: String(clientIp),
        upload_address: '{}',
        uploader_type: String(uploaderType),
        uploader_id: String(uploaderId),
        
        // 其他字段默认值设定
        directory: String(body['directory'] || '/'),
        tags: body['tags'] ? JSON.stringify(body['tags'].toString().split(',')) : null,
        is_public: (body['is_public'] === 'true' || body['is_public'] === true || body['is_public'] === '1' || !!body['is_public']) ? 1 : 0,
        is_chunked: 0,
        chunk_count: 0
    };

    // 执行数据库存入
    try {
        await db.insertInto('files').values(dbRecord).execute();
    } catch (insertErr) {
        console.error('[Upload] 数据库写入失败! 导致 SQLite 报错的数据快照:', JSON.stringify(dbRecord, null, 2));
        throw insertErr;
    }

    // 增量更新容量缓存
    storageManager.updateQuotaCache(channelId, file.size);
    storageManager.recordUpload(channelId);
    console.log(`[Upload] 文件上传成功 - ID: ${fileId}, Channel: ${channelId}`);
    
    // 最后返回成功数据和拼接的访问Url
    return c.json({
      code: 0,
      message: '文件上传成功',
      data: {
          id: fileId,
          url: `/${fileId}`, 
          file_name: newFileName,
          original_name: originalName,
          size: file.size
      }
    });

  } catch (err) {
    console.error('[Upload] 上传过程中端点发生崩溃: ', err);
    return c.json({
        code: 500,
        message: '处理文件上传异常',
        error: err.message
    }, 500);
  }
});

module.exports = uploadApp;
