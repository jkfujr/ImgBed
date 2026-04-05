import { Readable } from 'stream';
import ChunkManager from '../../storage/chunk-manager.js';
import { buildStreamHeaders } from './resolve-file-storage.js';

/**
 * 处理分块文件流
 */
async function handleChunkedStream(fileRecord, { start, end, isPartial, storageManager }) {
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

  return new Response(mergedStream, {
    status: isPartial ? 206 : 200,
    headers
  });
}

/**
 * 处理普通文件流
 */
async function handleRegularStream(fileRecord, storage, storageKey, { start, end, isPartial }) {
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

  let responseStream = fileStream;
  if (fileStream instanceof Readable) {
    responseStream = Readable.toWeb(fileStream);
  }

  return new Response(responseStream, {
    status: isPartial ? 206 : 200,
    headers
  });
}

export { handleChunkedStream,
  handleRegularStream, };
