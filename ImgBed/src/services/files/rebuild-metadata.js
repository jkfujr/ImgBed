import { createLogger } from '../../utils/logger.js';
import {
  countImageFilesForMetadataRebuild,
  listImageFilesForMetadataRebuildAfter,
  updateFileImageMetadata,
} from '../../database/files-dao.js';
import { toBuffer } from '../../utils/storage-io.js';
import { resolveStorageInstanceId } from './storage-artifacts.js';
import { readImageMetadata } from './image-metadata.js';

const REBUILD_METADATA_TASK_NAME = 'rebuild-metadata';
const DEFAULT_METADATA_REBUILD_BATCH_SIZE = 100;

async function processMetadataFile(file, {
  storageManager,
  logger = createLogger('files'),
  extractMetadata = readImageMetadata,
} = {}) {
  const storageId = resolveStorageInstanceId(file);
  const storage = storageManager.getStorage(storageId);
  if (!storage) {
    logger.warn?.({ fileId: file.id, storageId }, '元数据重建跳过：找不到存储实例');
    return { status: 'skipped', reason: 'missing_storage' };
  }

  const readResult = await storage.getStreamResponse(file.storage_key || file.id);
  const buffer = await toBuffer(readResult.stream);
  if (!buffer || buffer.length === 0) {
    logger.warn?.({ fileId: file.id }, '元数据重建跳过：文件内容为空');
    return { status: 'skipped', reason: 'empty_buffer' };
  }

  const metadata = await extractMetadata(buffer);
  return {
    status: 'updated',
    metadata,
  };
}

function createRebuildMetadataTaskDefinition({
  db,
  storageManager,
  logger = createLogger('files'),
  extractMetadata = readImageMetadata,
  batchSize = DEFAULT_METADATA_REBUILD_BATCH_SIZE,
} = {}) {
  return {
    name: REBUILD_METADATA_TASK_NAME,
    concurrency: 1,
    itemDelayMs: 50,
    async run({ force = false } = {}, taskRuntime = {}) {
      const total = countImageFilesForMetadataRebuild(db, force);
      const stats = {
        total,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      let afterId = null;

      logger.info?.({ force, total }, '开始执行元数据重建任务');

      while (true) {
        const files = listImageFilesForMetadataRebuildAfter(db, {
          force,
          afterId,
          limit: batchSize,
        });

        if (files.length === 0) {
          break;
        }

        await taskRuntime.processItems(files, async (file) => processMetadataFile(file, {
          storageManager,
          logger,
          extractMetadata,
        }).catch((error) => {
          logger.error?.({ fileId: file.id, err: error }, '元数据重建失败');
          return {
            status: 'failed',
            error,
          };
        }), {
          onResult: async (result, file) => {
            if (result.status === 'updated') {
              updateFileImageMetadata(db, file.id, result.metadata);
              stats.updated += 1;
              return;
            }

            if (result.status === 'failed') {
              stats.failed += 1;
              return;
            }

            stats.skipped += 1;
          },
        });

        afterId = files[files.length - 1].id;
      }

      logger.info?.({ force, stats }, '元数据重建任务完成');
      return stats;
    },
  };
}

export {
  DEFAULT_METADATA_REBUILD_BATCH_SIZE,
  REBUILD_METADATA_TASK_NAME,
  createRebuildMetadataTaskDefinition,
  processMetadataFile,
};
