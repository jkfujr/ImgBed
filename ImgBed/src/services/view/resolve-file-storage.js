import { parseStorageConfig } from '../files/storage-artifacts.js';

function resolveFileStorage(fileRecord, { storageManager }) {
  const configObj = parseStorageConfig(fileRecord.storage_config);
  const instanceId = fileRecord.storage_instance_id || configObj.instance_id;
  const storage = storageManager.getStorage(instanceId);

  if (!storage) {
    const error = new Error(`图床渠道调度失败，丢失底层映射处理器及备用配置: ${instanceId || fileRecord.storage_channel}`);
    error.status = 500;
    throw error;
  }

  return { storage, storageKey: fileRecord.storage_key };
}

function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader) {
    return { start: 0, end: totalSize - 1, isPartial: false };
  }

  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const reqStart = parseInt(parts[0], 10);
  const reqEnd = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

  if (isNaN(reqStart)) {
    return { start: 0, end: totalSize - 1, isPartial: false };
  }

  const start = reqStart;
  const end = Math.min(reqEnd, totalSize - 1);

  return { start, end, isPartial: true };
}

function buildStreamHeaders({ fileRecord, start, end, isPartial, totalSize }) {
  const headers = new Headers();
  headers.set('Content-Type', fileRecord.mime_type || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileRecord.original_name)}`);

  if (isPartial) {
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
  } else {
    headers.set('Content-Length', String(totalSize));
    headers.set('Accept-Ranges', 'bytes');
  }

  return headers;
}

export { resolveFileStorage,
  parseRangeHeader,
  buildStreamHeaders, };
