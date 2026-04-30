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
  signal = null,
  writeGenericChunksFn = writeGenericChunks,
  writeNativeMultipartObjectFn = writeNativeMultipartObject,
} = {}) {
  if (plan.mode === 'native') {
    const writeOptions = {
      storage,
      buffer,
      fileName: newFileName,
      mimeType,
      chunkConfig: plan.chunkConfig,
      config,
    };
    if (signal) {
      writeOptions.signal = signal;
    }

    const storageResult = await writeNativeMultipartObjectFn(writeOptions);

    return {
      storageResult,
      isChunked: 0,
      chunkCount: 0,
      chunkRecords: [],
    };
  }

  if (plan.mode === 'chunked') {
    const writeOptions = {
      storage,
      buffer,
      fileId,
      fileName: newFileName,
      mimeType,
      storageId: plan.storageId,
      storageType: plan.storageType,
      chunkConfig: plan.chunkConfig,
    };
    if (signal) {
      writeOptions.signal = signal;
    }

    const result = await writeGenericChunksFn(writeOptions);

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

  const putOptions = {
    id: fileId,
    fileName: newFileName,
    originalName,
    mimeType,
  };
  if (signal) {
    putOptions.signal = signal;
  }

  const storageResult = createStoragePutResult(await storage.put(buffer, putOptions));

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
