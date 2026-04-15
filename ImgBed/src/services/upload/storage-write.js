import { createStoragePutResult } from '../../storage/contract.js';
import { planStorageWrite } from '../../storage/write/storage-write-planner.js';
import { writeGenericChunks } from '../../storage/write/generic-chunk-writer.js';
import { writeNativeMultipartObject } from '../../storage/write/native-multipart-writer.js';

function resolveStorageWritePlan({
  storage,
  fileSize,
  storageId,
  storageManager,
  storageType = null,
  planStorageWriteFn = planStorageWrite,
} = {}) {
  return planStorageWriteFn({
    storage,
    fileSize,
    storageId,
    storageType,
    storageManager,
  });
}

async function executePlannedBufferWrite({
  plan,
  storage,
  buffer,
  fileId,
  newFileName,
  originalName,
  mimeType,
  config,
  writeGenericChunksFn = writeGenericChunks,
  writeNativeMultipartObjectFn = writeNativeMultipartObject,
} = {}) {
  if (plan.mode === 'native') {
    const storageResult = await writeNativeMultipartObjectFn({
      storage,
      buffer,
      fileName: newFileName,
      mimeType,
      chunkConfig: plan.chunkConfig,
      config,
    });

    return {
      storageResult,
      isChunked: 0,
      chunkCount: 0,
      chunkRecords: [],
    };
  }

  if (plan.mode === 'chunked') {
    const result = await writeGenericChunksFn({
      storage,
      buffer,
      fileId,
      fileName: newFileName,
      mimeType,
      storageId: plan.storageId,
      storageType: plan.storageType,
      chunkConfig: plan.chunkConfig,
    });

    return {
      storageResult: createStoragePutResult({
        storageKey: fileId,
        size: buffer.length,
      }),
      isChunked: 1,
      chunkCount: result.chunkCount,
      chunkRecords: result.chunkRecords,
    };
  }

  const storageResult = createStoragePutResult(await storage.put(buffer, {
    id: fileId,
    fileName: newFileName,
    originalName,
    mimeType,
  }));

  return {
    storageResult,
    isChunked: 0,
    chunkCount: 0,
    chunkRecords: [],
  };
}

export {
  executePlannedBufferWrite,
  resolveStorageWritePlan,
};
