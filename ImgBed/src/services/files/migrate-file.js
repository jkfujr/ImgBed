import pLimit from 'p-limit';
import { Readable } from 'stream';
import { parseStorageConfig } from './delete-file.js';

const WRITABLE_STORAGE_TYPES = new Set(['local', 's3', 'huggingface']);

function createFilesError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateMigrationTarget(targetChannel, storageManager) {
  if (!targetChannel) {
    throw createFilesError(400, '迁移操作必须指定 target_channel（目标渠道ID）');
  }

  const targetEntry = storageManager.instances.get(targetChannel);
  if (!targetEntry) {
    throw createFilesError(404, `目标渠道不存在: ${targetChannel}`);
  }

  if (!storageManager.isUploadAllowed(targetChannel)) {
    throw createFilesError(403, `目标渠道不支持写入: ${targetChannel}`);
  }

  if (!WRITABLE_STORAGE_TYPES.has(targetEntry.type)) {
    throw createFilesError(403, `目标渠道类型 ${targetEntry.type} 不支持作为迁移目标`);
  }

  return targetEntry;
}

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }

  if (stream instanceof Readable) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function migrateFileRecord(fileRecord, { targetChannel, targetEntry, db, storageManager }) {
  const sourceConfig = parseStorageConfig(fileRecord.storage_config);
  const sourceInstanceId = fileRecord.storage_instance_id || sourceConfig.instance_id;

  if (sourceInstanceId === targetChannel) {
    return { status: 'skipped' };
  }

  const sourceEntry = storageManager.instances.get(sourceInstanceId);
  if (!sourceEntry) {
    return { status: 'failed', reason: '源渠道不存在' };
  }

  const fileStream = await sourceEntry.instance.getStream(fileRecord.storage_key);
  const fileBuffer = await streamToBuffer(fileStream);
  const uploadResult = await targetEntry.instance.put(fileBuffer, {
    id: fileRecord.id,
    fileName: fileRecord.file_name,
    originalName: fileRecord.original_name,
    mimeType: fileRecord.mime_type,
  });

  const runMigrate = () => {
    db.prepare(`UPDATE files SET
        storage_channel = ?,
        storage_key = ?,
        storage_config = ?,
        storage_instance_id = ?
      WHERE id = ?`).run(
      targetEntry.type,
      uploadResult.id || fileRecord.storage_key,
      JSON.stringify({
        instance_id: targetChannel,
        extra_result: uploadResult,
      }),
      targetChannel,
      fileRecord.id
    );

    const fileSize = Number(fileRecord.size) || 0;
    if (sourceInstanceId) {
      storageManager.updateQuotaCache(sourceInstanceId, -fileSize);
    }
    storageManager.updateQuotaCache(targetChannel, fileSize);
  };

  try {
    if (typeof db.transaction === 'function') {
      db.transaction(runMigrate)();
    } else {
      runMigrate();
    }
  } catch (err) {
    console.error('[Files API] 迁移后更新容量缓存失败:', err.message);
    throw err;
  }

  return { status: 'success' };
}

async function migrateFilesBatch(files, { targetChannel, db, storageManager, logger = console }) {
  const targetEntry = validateMigrationTarget(targetChannel, storageManager);
  const limit = pLimit(3); // 并发度为 3
  const results = {
    total: files.length,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const tasks = files.map((fileRecord) =>
    limit(async () => {
      try {
        const result = await migrateFileRecord(fileRecord, {
          targetChannel,
          targetEntry,
          db,
          storageManager,
        });

        return { fileRecord, result };
      } catch (err) {
        logger.error(`[Files API] 迁移文件 ${fileRecord.id} 失败:`, err.message);
        return { fileRecord, error: err };
      }
    })
  );

  const taskResults = await Promise.all(tasks);

  for (const item of taskResults) {
    if (item.error) {
      results.failed++;
      results.errors.push({ id: item.fileRecord.id, reason: item.error.message });
      continue;
    }

    if (item.result.status === 'success') {
      results.success++;
    } else if (item.result.status === 'skipped') {
      results.skipped++;
    } else {
      results.failed++;
      results.errors.push({ id: item.fileRecord.id, reason: item.result.reason || '迁移失败' });
    }
  }

  return results;
}

export { createFilesError,
  validateMigrationTarget,
  migrateFileRecord,
  migrateFilesBatch, };
