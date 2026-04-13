import { updateFileImageMetadata, getImageFilesForMetadataRebuild } from '../../database/files-dao.js';
import { toBuffer } from '../../utils/storage-io.js';
import { resolveStorageInstanceId } from './storage-artifacts.js';
import { readImageMetadata } from './image-metadata.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildMetadataForFile(file, { db, storageManager, logger = console, wait = sleep, sleepMs = 50, extractMetadata = readImageMetadata }) {
  const storageId = resolveStorageInstanceId(file);
  const storage = storageManager.getStorage(storageId);
  if (!storage) {
    logger.warn(`[Maintenance] 找不到存储实例: ${storageId} (File: ${file.id})`);
    return { status: 'skipped', reason: 'missing_storage' };
  }

  const readResult = await storage.getStreamResponse(file.storage_key || file.id);
  const buffer = await toBuffer(readResult.stream);
  if (!buffer || buffer.length === 0) {
    logger.warn(`[Maintenance] 文件内容为空: ${file.id}`);
    return { status: 'skipped', reason: 'empty_buffer' };
  }

  const metadata = await extractMetadata(buffer);
  updateFileImageMetadata(db, file.id, metadata);

  await wait(sleepMs);
  return { status: 'updated' };
}

async function rebuildMetadataTask({ force, db, storageManager, logger = console, wait = sleep, sleepMs = 50, extractMetadata = readImageMetadata }) {
  logger.log(`[Maintenance] 开始${force ? '全量' : '增量'}重建元数据...`);

  const files = getImageFilesForMetadataRebuild(db, force);
  logger.log(`[Maintenance] 找到 ${files.length} 个待处理文件`);

  const stats = { total: files.length, updated: 0, skipped: 0, failed: 0 };

  for (const file of files) {
    try {
      const result = await rebuildMetadataForFile(file, {
        db,
        storageManager,
        logger,
        wait,
        sleepMs,
        extractMetadata,
      });

      if (result.status === 'updated') {
        stats.updated++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      logger.error(`[Maintenance] 处理文件 ${file.id} 失败:`, err.message);
      stats.failed++;
    }
  }

  logger.log('[Maintenance] 元数据重建任务完成');
  return stats;
}

export {
  rebuildMetadataForFile,
  rebuildMetadataTask,
};
