import pLimit from 'p-limit';

import { createStoragePutResult } from '../contract.js';
import { createLogger } from '../../utils/logger.js';
import { throwIfAborted } from '../../utils/abort-signal.js';

const log = createLogger('native-multipart-writer');

function withSignal(options, signal) {
  return signal ? { ...options, signal } : options;
}

async function writeNativeMultipartObject({
  storage,
  buffer,
  fileName,
  mimeType,
  chunkConfig = null,
  config,
  signal = null,
} = {}) {
  throwIfAborted(signal);
  const resolvedChunkConfig = chunkConfig || storage.getChunkConfig();
  const totalChunks = Math.ceil(buffer.length / resolvedChunkConfig.chunkSize);
  let multipart;

  const performanceConfig = config?.performance?.s3Multipart || {};
  const concurrencyEnabled = performanceConfig.enabled !== false;
  const concurrency = Math.min(
    Math.max(1, performanceConfig.concurrency || 4),
    performanceConfig.maxConcurrency || 8
  );

  try {
    multipart = await storage.initMultipartUpload(withSignal({
      fileName,
      mimeType,
    }, signal));

    const parts = [];

    if (concurrencyEnabled && concurrency > 1) {
      const limit = pLimit(concurrency);
      const uploadTasks = [];

      for (let index = 0; index < totalChunks; index++) {
        const partNumber = index + 1;
        const start = index * resolvedChunkConfig.chunkSize;
        const end = Math.min(start + resolvedChunkConfig.chunkSize, buffer.length);
        const chunkBuffer = buffer.subarray(start, end);

        throwIfAborted(signal);
        uploadTasks.push(limit(async () => storage.uploadPart(chunkBuffer, withSignal({
          uploadId: multipart.uploadId,
          key: multipart.key,
          partNumber,
        }, signal))));
      }

      const uploadedParts = await Promise.all(uploadTasks);
      parts.push(...uploadedParts);
      parts.sort((left, right) => left.partNumber - right.partNumber);

      log.info({
        totalChunks,
        concurrency,
        uploadId: multipart.uploadId,
      }, 'S3 并发 Multipart 上传完成');
    } else {
      for (let index = 0; index < totalChunks; index++) {
        const start = index * resolvedChunkConfig.chunkSize;
        const end = Math.min(start + resolvedChunkConfig.chunkSize, buffer.length);
        const chunkBuffer = buffer.subarray(start, end);

        throwIfAborted(signal);
        const part = await storage.uploadPart(chunkBuffer, withSignal({
          uploadId: multipart.uploadId,
          key: multipart.key,
          partNumber: index + 1,
        }, signal));
        parts.push(part);
      }

      log.info({
        totalChunks,
        mode: 'serial',
        uploadId: multipart.uploadId,
      }, 'S3 串行 Multipart 上传完成');
    }

    const result = await storage.completeMultipartUpload(withSignal({
      uploadId: multipart.uploadId,
      key: multipart.key,
      parts,
    }, signal));

    return createStoragePutResult({
      storageKey: result.storageKey,
      size: result.size ?? buffer.length,
      deleteToken: result.deleteToken,
    });
  } catch (error) {
    if (multipart?.uploadId) {
      try {
        await storage.abortMultipartUpload({
          uploadId: multipart.uploadId,
          key: multipart.key,
        });
        log.warn({ uploadId: multipart.uploadId }, 'S3 Multipart 上传失败，已中止');
      } catch (abortError) {
        log.error({ err: abortError }, 'S3 abort multipart 失败');
      }
    }

    throw error;
  }
}

export {
  writeNativeMultipartObject,
};
