const { Hono } = require('hono');
const crypto = require('crypto');
const storageManager = require('../storage/manager');
const sharp = require('sharp');
const { db } = require('../database');
const { requirePermission } = require('../middleware/auth');
const config = require('../config');
const path = require('path');
const { resolveUploadChannel } = require('../services/upload/resolve-upload');
const { checkUploadQuota } = require('../services/upload/check-upload-quota');
const { executeUploadWithFailover } = require('../services/upload/execute-upload');

const uploadApp = new Hono();
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];

function createResponseError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateUploadFile(file) {
  if (!file || typeof file === 'string') {
    throw createResponseError(400, '未检测到文件上传或字段错误');
  }

  const maxSize = config.security?.maxFileSize || 100 * 1024 * 1024;
  if (file.size > maxSize) {
    throw createResponseError(413, '文件体积超出服务器限制');
  }
}

async function extractFileMetadata(file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const originalName = file.name || 'blob';
  const rawExt = path.extname(originalName).toLowerCase();
  const mimeExt = file.type ? `.${file.type.split('/')[1]}`.replace('.jpeg', '.jpg') : '';
  const extension = rawExt || mimeExt || '';
  const isImageMime = file.type && file.type.startsWith('image/');
  const isImageExt = ALLOWED_EXTENSIONS.includes(extension.toLowerCase());

  if (!isImageMime || !isImageExt) {
    throw createResponseError(400, `非法文件格式: ${file.type || '未知'} (${extension || '无后缀'})。本站仅支持图片托管。`);
  }

  let width = null;
  let height = null;
  let exif = null;
  try {
    const metadata = await sharp(buffer).metadata();
    width = metadata.width || null;
    height = metadata.height || null;
    const { format, size, width: metaWidth, height: metaHeight, space, channels, depth, density, hasProfile, hasAlpha, orientation, exif: rawExif } = metadata;
    exif = JSON.stringify({
      format,
      size,
      width: metaWidth,
      height: metaHeight,
      space,
      channels,
      depth,
      density,
      hasProfile,
      hasAlpha,
      orientation,
      hasExif: !!rawExif,
    });
  } catch (metaErr) {
    console.warn(`[Upload] 提取文件 ${file.name} 元数据失败:`, metaErr.message);
  }

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').substring(0, 12);
  const baseNameOnly = originalName.replace(/\.[^/.]+$/, '');
  const safeBaseName = baseNameOnly.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 24);
  const fileId = `${hash}_${safeBaseName || 'file'}${extension}`;

  return {
    buffer,
    originalName,
    extension,
    fileId,
    newFileName: fileId,
    mimeType: file.type || 'application/octet-stream',
    width,
    height,
    exif,
  };
}

function buildUploadRecord({ fileId, newFileName, originalName, mimeType, fileSize, body, finalChannelId, storageResult, isChunked, chunkCount, width, height, exif, auth, clientIp }) {
  return {
    id: String(fileId),
    file_name: String(newFileName),
    original_name: String(originalName),
    mime_type: String(mimeType),
    size: Number(fileSize),
    storage_channel: String(storageManager.instances.get(finalChannelId)?.type || 'unknown'),
    storage_key: String(storageResult.id || newFileName),
    storage_config: JSON.stringify({
      instance_id: finalChannelId,
      extra_result: storageResult,
    }),
    upload_ip: String(clientIp),
    upload_address: '{}',
    uploader_type: String(auth?.type || 'admin_jwt'),
    uploader_id: String(auth?.tokenId || auth?.username || 'admin'),
    directory: String(body['directory'] || '/'),
    tags: body['tags'] ? JSON.stringify(body['tags'].toString().split(',')) : null,
    is_public: (body['is_public'] === 'true' || body['is_public'] === true || body['is_public'] === '1' || !!body['is_public']) ? 1 : 0,
    is_chunked: isChunked,
    chunk_count: chunkCount,
    width,
    height,
    exif,
  };
}

function buildUploadResponse({ fileId, newFileName, originalName, fileSize, width, height, finalChannelId, failedChannels }) {
  const responseData = {
    id: fileId,
    url: `/${fileId}`,
    file_name: newFileName,
    original_name: originalName,
    size: fileSize,
    width,
    height,
  };

  if (failedChannels.length > 0) {
    responseData.failover = {
      retries: failedChannels.length,
      failed: failedChannels.map((item) => item.id),
      final_channel: finalChannelId,
    };
  }

  return {
    code: 0,
    message: failedChannels.length > 0
      ? `文件上传成功（经过 ${failedChannels.length} 次渠道切换）`
      : '文件上传成功',
    data: responseData,
  };
}

/**
 * 文件上传接口
 * POST /api/upload
 * （可选择是否需要 adminAuth。根据需求目前加上管理员拦截。若作为公共图床，后续可配置为宽松模式）
 */
uploadApp.post('/', requirePermission('upload:image'), async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    validateUploadFile(file);

    const { channelId } = resolveUploadChannel(body, storageManager, config);
    const quotaAllowed = await checkUploadQuota({ channelId, storageManager, db, config });
    if (!quotaAllowed) {
      return c.json({ code: 403, message: `渠道 [${channelId}] 容量已达到停用阈值，已关闭上传功能`, error: {} }, 403);
    }

    const fileMeta = await extractFileMetadata(file);
    const uploadResult = await executeUploadWithFailover({
      initialChannelId: channelId,
      buffer: fileMeta.buffer,
      fileId: fileMeta.fileId,
      newFileName: fileMeta.newFileName,
      originalName: fileMeta.originalName,
      mimeType: fileMeta.mimeType,
      storageManager,
      config,
    });

    if (uploadResult.failedChannels.length > 0) {
      console.info(`[Upload Failover] 文件 ${fileMeta.fileId} 经过 ${uploadResult.failedChannels.length} 次切换后成功上传到 ${uploadResult.finalChannelId}`);
    }

    const dbRecord = buildUploadRecord({
      fileId: fileMeta.fileId,
      newFileName: fileMeta.newFileName,
      originalName: fileMeta.originalName,
      mimeType: fileMeta.mimeType,
      fileSize: file.size,
      body,
      finalChannelId: uploadResult.finalChannelId,
      storageResult: uploadResult.storageResult,
      isChunked: uploadResult.isChunked,
      chunkCount: uploadResult.chunkCount,
      width: fileMeta.width,
      height: fileMeta.height,
      exif: fileMeta.exif,
      auth: c.get('auth'),
      clientIp: c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown',
    });

    try {
      await db.insertInto('files').values(dbRecord).execute();
    } catch (insertErr) {
      console.error('[Upload] 数据库写入失败! 导致 SQLite 报错的数据快照:', JSON.stringify(dbRecord, null, 2));
      throw insertErr;
    }

    storageManager.updateQuotaCache(uploadResult.finalChannelId, file.size);
    storageManager.recordUpload(uploadResult.finalChannelId);
    console.log(`[Upload] 文件上传成功 - ID: ${fileMeta.fileId}, Channel: ${uploadResult.finalChannelId}`);

    return c.json(buildUploadResponse({
      fileId: fileMeta.fileId,
      newFileName: fileMeta.newFileName,
      originalName: fileMeta.originalName,
      fileSize: file.size,
      width: fileMeta.width,
      height: fileMeta.height,
      finalChannelId: uploadResult.finalChannelId,
      failedChannels: uploadResult.failedChannels,
    }));
  } catch (err) {
    if (err.status) {
      return c.json({ code: err.status, message: err.message, error: {} }, err.status);
    }

    console.error('[Upload] 上传过程中端点发生崩溃: ', err);
    return c.json({
      code: 500,
      message: '处理文件上传异常',
      error: err.message,
    }, 500);
  }
});

module.exports = uploadApp;
