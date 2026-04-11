import sharp from 'sharp';
import { parseStorageConfig } from './storage-artifacts.js';
import { updateFileImageMetadata, getImageFilesForMetadataRebuild } from '../../database/files-dao.js';
import { streamToBuffer } from '../../utils/stream.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveFileStorageId(file) {
  const config = parseStorageConfig(file.storage_config);
  return config.instance_id || file.storage_channel;
}

async function extractImageMetadata(buffer) {
  const metadata = await sharp(buffer).metadata();
  const { format, size, width, height, space, channels, depth, density, hasProfile, hasAlpha, orientation, exif: rawExif } = metadata;
  return {
    width: width || null,
    height: height || null,
    exif: JSON.stringify({
      format,
      size,
      width,
      height,
      space,
      channels,
      depth,
      density,
      hasProfile,
      hasAlpha,
      orientation,
      hasExif: !!rawExif,
    }),
  };
}

async function rebuildMetadataForFile(file, { db, storageManager, logger = console, wait = sleep, sleepMs = 50, extractMetadata = extractImageMetadata }) {
  const storageId = resolveFileStorageId(file);
  const storage = storageManager.getStorage(storageId);
  if (!storage) {
    logger.warn(`[Maintenance] 找不到存储实例: ${storageId} (File: ${file.id})`);
    return { status: 'skipped', reason: 'missing_storage' };
  }

  const stream = await storage.getStream(file.storage_key || file.id);
  const buffer = await streamToBuffer(stream);
  if (!buffer || buffer.length === 0) {
    logger.warn(`[Maintenance] 文件内容为空: ${file.id}`);
    return { status: 'skipped', reason: 'empty_buffer' };
  }

  const metadata = await extractMetadata(buffer);
  updateFileImageMetadata(db, file.id, metadata);

  await wait(sleepMs);
  return { status: 'updated' };
}

async function rebuildMetadataTask({ force, db, storageManager, logger = console, wait = sleep, sleepMs = 50, extractMetadata = extractImageMetadata }) {
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

export { extractImageMetadata,
  rebuildMetadataForFile,
  rebuildMetadataTask,
  resolveFileStorageId, };
