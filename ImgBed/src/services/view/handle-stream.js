import { Readable } from 'stream';
import ChunkManager from '../../storage/chunk-manager.js';
import { buildStreamHeaders } from './resolve-file-storage.js';

const applyHeaders = (res, headers) => {
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      res.setHeader(key, value);
    }
  });
};

/**
 * 处理分块文件流
 */
async function handleChunkedStream(fileRecord, res, { start, end, isPartial, storageManager }) {
  const chunks = await ChunkManager.getChunks(fileRecord.id);
  if (!chunks || chunks.length === 0) {
    const error = new Error('分块记录缺失，无法重组文件');
    error.status = 500;
    throw error;
  }

  const getStorageFn = (storageId) => storageManager.getStorage(storageId);
  const mergedStream = ChunkManager.createChunkedReadStream(chunks, getStorageFn, {
    start,
    end,
    totalSize: fileRecord.size
  });

  const headers = buildStreamHeaders({
    fileRecord,
    start,
    end,
    isPartial,
    totalSize: fileRecord.size
  });

  applyHeaders(res, headers);
  res.status(isPartial ? 206 : 200);
  mergedStream.pipe(res);
  return res;
}

/**
 * 处理普通文件流
 */
async function handleRegularStream(fileRecord, res, storage, storageKey, { start, end, isPartial }) {
  const options = isPartial ? { start, end } : {};

  const fileStream = await storage.getStream(storageKey, options).catch(e => {
    console.error(`[View API] 拉取真实流 ${storageKey} 出错:`, e.message);
    return null;
  });

  if (!fileStream) {
    const error = new Error('向原点提取文件内容失败，上游节点未响应');
    error.status = 502;
    throw error;
  }

  const headers = buildStreamHeaders({
    fileRecord,
    start,
    end,
    isPartial,
    totalSize: fileRecord.size
  });

  applyHeaders(res, headers);
  res.status(isPartial ? 206 : 200);

  if (fileStream instanceof Readable) {
    fileStream.pipe(res);
    return res;
  }

  Readable.fromWeb(fileStream).pipe(res);
  return res;
}

export { handleChunkedStream,
  handleRegularStream, };
