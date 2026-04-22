import { serializeStorageMeta } from '../files/storage-artifacts.js';

function buildPublicFileUrl(fileId) {
  return `/${encodeURIComponent(String(fileId))}`;
}

function buildUploadRecord({
  storageManager,
  fileId,
  newFileName,
  originalName,
  mimeType,
  fileSize,
  body,
  directory,
  finalChannelId,
  storageResult,
  isChunked,
  chunkCount,
  width,
  height,
  exif,
  auth,
  clientIp,
} = {}) {
  const storageMeta = storageManager.getStorageMeta(finalChannelId);

  return {
    id: String(fileId),
    file_name: String(newFileName),
    original_name: String(originalName),
    mime_type: String(mimeType),
    size: Number(fileSize),
    storage_channel: String(storageMeta?.type || 'unknown'),
    storage_key: String(storageResult.storageKey),
    storage_meta: serializeStorageMeta({ deleteToken: storageResult.deleteToken }),
    storage_instance_id: String(finalChannelId),
    upload_ip: String(clientIp),
    upload_address: '{}',
    uploader_type: String(auth?.type || 'admin_jwt'),
    uploader_id: String(auth?.tokenId || auth?.username || 'admin'),
    directory,
    tags: body['tags'] ? JSON.stringify(body['tags'].toString().split(',')) : null,
    is_public: (body['is_public'] === 'true' || body['is_public'] === true || body['is_public'] === '1' || !!body['is_public']) ? 1 : 0,
    is_chunked: isChunked,
    chunk_count: chunkCount,
    width,
    height,
    exif,
    status: 'active',
  };
}

function resolveStoredFileSize(storageResult, fallbackSize) {
  const actualSize = Number(storageResult?.size);
  if (Number.isFinite(actualSize) && actualSize >= 0) {
    return actualSize;
  }

  const originalSize = Number(fallbackSize);
  return Number.isFinite(originalSize) ? originalSize : 0;
}

function buildUploadResponse({
  fileId,
  newFileName,
  originalName,
  fileSize,
  width,
  height,
  finalChannelId,
  failedChannels = [],
} = {}) {
  const data = {
    id: fileId,
    url: buildPublicFileUrl(fileId),
    file_name: newFileName,
    original_name: originalName,
    size: fileSize,
    width,
    height,
  };

  if (failedChannels.length > 0) {
    data.failover = {
      retries: failedChannels.length,
      failed: failedChannels.map((item) => item.id),
      final_channel: finalChannelId,
    };
  }

  return {
    data,
    message: failedChannels.length > 0
      ? `文件上传成功（经过 ${failedChannels.length} 次渠道切换）`
      : '文件上传成功',
  };
}

export {
  buildPublicFileUrl,
  buildUploadRecord,
  buildUploadResponse,
  resolveStoredFileSize,
};
