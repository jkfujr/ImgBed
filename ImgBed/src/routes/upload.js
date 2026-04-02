const { Hono } = require('hono');
const crypto = require('crypto');
const storageManager = require('../storage/manager');
const ChunkManager = require('../storage/chunk-manager');
const sharp = require('sharp');
const { db } = require('../database');
const { requirePermission } = require('../middleware/auth');
const config = require('../config');
const path = require('path');

const uploadApp = new Hono();

/**
 * 判断上传错误是否可重试（用于失败自动切换）
 * 文件格式、大小等客户端错误在上传流程早期已被拦截，
 * 能走到 storage.put() 的错误基本都是渠道侧问题，默认视为可重试。
 */
function isRetryableError(error) {
    // 网络层错误
    const networkCodes = ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN'];
    if (networkCodes.includes(error.code)) return true;

    // HTTP 状态码（部分存储 SDK 会将状态码挂在 error 上）
    const status = error.status || error.statusCode || error.response?.status;
    if (status && (status === 429 || status >= 500)) return true;

    // 通用错误消息匹配
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('unavailable')) return true;

    // 默认视为可重试
    return true;
}

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

    // 提取图片元数据（宽、高、EXIF）
    let width = null, height = null, exif = null;
    if (file.type.startsWith('image/')) {
        try {
            const metadata = await sharp(buffer).metadata();
            width = metadata.width || null;
            height = metadata.height || null;
            // 如果有元数据，则存储为 JSON 字符串
            if (metadata) {
                const { format, size, width: w, height: h, space, channels, depth, density, hasProfile, hasAlpha, orientation, exif: rawExif } = metadata;
                exif = JSON.stringify({ format, size, width: w, height: h, space, channels, depth, density, hasProfile, hasAlpha, orientation, hasExif: !!rawExif });
            }
        } catch (metaErr) {
            console.warn(`[Upload] 提取文件 ${file.name} 元数据失败:`, metaErr.message);
        }
    }

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
    
    // 执行底层物理存储（支持失败自动切换）
    const failoverEnabled = config.storage?.failoverEnabled !== false;
    const lbActive = (config.storage?.loadBalanceStrategy || 'default') !== 'default';
    const maxRetries = 3; // 最多尝试的备选渠道数
    const failedChannels = [];
    let storageResult;
    let finalChannelId = channelId;
    let isChunked = 0;
    let chunkCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const currentStorage = storageManager.getStorage(finalChannelId);
        if (!currentStorage) {
            failedChannels.push({ id: finalChannelId, error: '渠道实例不存在' });
            // 渠道不存在，尝试切换到其他渠道
            if (failoverEnabled && attempt < maxRetries) {
                const excludeIds = failedChannels.map(f => f.id);
                const nextChannelId = storageManager.selectUploadChannel(null, excludeIds);
                if (nextChannelId) {
                    console.log(`[Upload Failover] 渠道 ${finalChannelId} 不存在，切换到: ${nextChannelId}`);
                    finalChannelId = nextChannelId;
                    continue;
                }
            }
            throw new Error(`找不到可用的存储渠道`);
        }

        try {
            // 获取有效上传限制（渠道级优先，未开启则回退到系统级）
            const limits = storageManager.getEffectiveUploadLimits(finalChannelId);

            // 最大限制检查（硬上限，最先检查）
            if (limits.enableMaxLimit) {
                const maxLimitBytes = limits.maxLimitMB * 1024 * 1024;
                if (buffer.length > maxLimitBytes) {
                    const err = new Error(`文件体积超出最大限制 ${limits.maxLimitMB}MB`);
                    err._sizeLimit = true;
                    throw err;
                }
            }

            // 大小限制检查
            if (limits.enableSizeLimit) {
                const sizeLimitBytes = limits.sizeLimitMB * 1024 * 1024;
                if (buffer.length > sizeLimitBytes && !limits.enableChunking) {
                    const err = new Error(`文件体积超出大小限制 ${limits.sizeLimitMB}MB`);
                    err._sizeLimit = true;
                    throw err;
                }
            }

            // 分块上传三分支判断
            const mimeType = file.type || 'application/octet-stream';
            const chunkAnalysis = ChunkManager.analyze(currentStorage, buffer.length, {
                channelConfig: limits.enableChunking ? {
                    enableChunking: true,
                    sizeLimitMB: limits.sizeLimitMB,
                    chunkSizeMB: limits.chunkSizeMB,
                    maxChunks: limits.maxChunks,
                } : null
            });

            if (chunkAnalysis.needsChunking && chunkAnalysis.config.mode === 'native') {
                // S3 原生 multipart（完成后是完整对象，不标记 is_chunked）
                const result = await ChunkManager.uploadS3Multipart(currentStorage, buffer, {
                    fileId, fileName: newFileName, originalName, mimeType, storageId: finalChannelId
                });
                storageResult = { id: result.id };
            } else if (chunkAnalysis.needsChunking) {
                // 通用分块上传（TG/Discord/HF）
                const result = await ChunkManager.uploadChunked(currentStorage, buffer, {
                    fileId, fileName: newFileName, originalName, mimeType, storageId: finalChannelId
                });
                storageResult = { id: fileId };
                isChunked = 1;
                chunkCount = result.chunkCount;
            } else {
                // 直接上传（不分块）
                storageResult = await currentStorage.put(buffer, {
                    id: fileId, fileName: newFileName, originalName, mimeType
                });
            }
            break; // 上传成功，跳出循环
        } catch (err) {
            console.warn(`[Upload Failover] 渠道 ${finalChannelId} 上传失败: ${err.message}`);
            failedChannels.push({ id: finalChannelId, error: err.message });

            // 重置分块状态，避免上一个渠道的分块结果污染下一个渠道
            isChunked = 0;
            chunkCount = 0;

            // 判断是否可以切换到其他渠道
            // 大小限制错误：需要开启 failover 或负载均衡才自动切换
            // 其他错误：需要开启 failover 且为可重试错误
            const canRetry = err._sizeLimit
                ? (failoverEnabled || lbActive)
                : (failoverEnabled && isRetryableError(err));

            if (!canRetry || attempt >= maxRetries) {
                // 如果全部渠道都因大小限制失败，返回 413
                if (err._sizeLimit) {
                    return c.json({
                        code: 413,
                        message: err.message + (failedChannels.length > 1 ? ` (已尝试 ${failedChannels.length} 个渠道)` : ''),
                        error: {}
                    }, 413);
                }
                throw new Error('底层文件流转储失败: ' + err.message
                    + (failedChannels.length > 1 ? ` (已尝试 ${failedChannels.length} 个渠道)` : ''));
            }

            // 复用 selectUploadChannel，排除已失败的渠道
            const excludeIds = failedChannels.map(f => f.id);
            const nextChannelId = storageManager.selectUploadChannel(null, excludeIds);
            if (!nextChannelId) {
                throw new Error('所有可用渠道均已尝试，上传失败');
            }

            console.log(`[Upload Failover] 切换到备选渠道: ${nextChannelId}`);
            finalChannelId = nextChannelId;
        }
    }

    // 如果发生了渠道切换，记录日志
    if (failedChannels.length > 0) {
        console.info(`[Upload Failover] 文件 ${fileId} 经过 ${failedChannels.length} 次切换后成功上传到 ${finalChannelId}`);
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
        storage_channel: String(storageManager.instances.get(finalChannelId)?.type || 'unknown'),
        storage_key: String(storageResult.id || newFileName),
        storage_config: JSON.stringify({
            instance_id: finalChannelId,
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
        is_chunked: isChunked,
        chunk_count: chunkCount,
        width: width,
        height: height,
        exif: exif
    };

    // 执行数据库存入
    try {
        await db.insertInto('files').values(dbRecord).execute();
    } catch (insertErr) {
        console.error('[Upload] 数据库写入失败! 导致 SQLite 报错的数据快照:', JSON.stringify(dbRecord, null, 2));
        throw insertErr;
    }

    // 增量更新容量缓存
    storageManager.updateQuotaCache(finalChannelId, file.size);
    storageManager.recordUpload(finalChannelId);
    console.log(`[Upload] 文件上传成功 - ID: ${fileId}, Channel: ${finalChannelId}`);
    
    // 最后返回成功数据和拼接的访问Url
    const responseData = {
        id: fileId,
        url: `/${fileId}`,
        file_name: newFileName,
        original_name: originalName,
        size: file.size,
        width: width,
        height: height
    };

    // 发生过渠道切换时附带信息
    if (failedChannels.length > 0) {
        responseData.failover = {
            retries: failedChannels.length,
            failed: failedChannels.map(f => f.id),
            final_channel: finalChannelId
        };
    }

    return c.json({
      code: 0,
      message: failedChannels.length > 0
          ? `文件上传成功（经过 ${failedChannels.length} 次渠道切换）`
          : '文件上传成功',
      data: responseData
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
