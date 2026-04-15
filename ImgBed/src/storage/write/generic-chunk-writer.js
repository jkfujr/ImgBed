import pLimit from 'p-limit';

import { createLogger } from '../../utils/logger.js';
import { parseStorageMeta, serializeStorageMeta } from '../../utils/storage-meta.js';

const log = createLogger('generic-chunk-writer');

async function writeGenericChunks({
  storage,
  buffer,
  fileId,
  fileName,
  mimeType,
  storageId,
  storageType,
  chunkConfig = null,
} = {}) {
  if (!storageType) {
    throw new Error('普通分块写入缺少 storageType');
  }

  if (typeof storage.uploadChunkedBatch === 'function') {
    return storage.uploadChunkedBatch(buffer, {
      fileId,
      fileName,
      mimeType,
      storageId,
      storageType,
    });
  }

  const config = chunkConfig || storage.getChunkConfig();
  const totalChunks = Math.ceil(buffer.length / config.chunkSize);
  const chunkRecords = [];
  const limit = pLimit(3);

  try {
    const tasks = Array.from({ length: totalChunks }, (_, index) => limit(async () => {
      const start = index * config.chunkSize;
      const end = Math.min(start + config.chunkSize, buffer.length);
      const chunkBuffer = buffer.subarray(start, end);

      let result;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          result = await storage.putChunk(chunkBuffer, {
            fileId,
            chunkIndex: index,
            totalChunks,
            fileName,
            mimeType,
          });
          break;
        } catch (error) {
          log.warn({ chunkIndex: index, attempt: attempt + 1, err: error }, '分块上传尝试失败');
          if (attempt >= 2) {
            throw error;
          }

          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }

      const record = {
        file_id: fileId,
        chunk_index: index,
        storage_type: storageType,
        storage_id: storageId,
        storage_key: result.storageKey,
        storage_meta: serializeStorageMeta({ deleteToken: result.deleteToken }),
        size: result.size,
      };

      chunkRecords.push(record);
      return record;
    }));

    const records = await Promise.all(tasks);
    chunkRecords.length = 0;
    chunkRecords.push(...records.sort((left, right) => left.chunk_index - right.chunk_index));
  } catch (error) {
    log.warn({ uploadedCount: chunkRecords.length }, '分块上传中途失败，清理已上传块');

    for (const record of chunkRecords) {
      try {
        const chunkMeta = parseStorageMeta(record.storage_meta);
        await storage.deleteChunk(record.storage_key, chunkMeta.deleteToken || null);
      } catch (cleanupError) {
        log.warn({ storageKey: record.storage_key, err: cleanupError }, '清理孤儿块失败（忽略）');
      }
    }

    throw error;
  }

  return {
    chunkCount: totalChunks,
    totalSize: buffer.length,
    chunkRecords,
  };
}

export {
  writeGenericChunks,
};
