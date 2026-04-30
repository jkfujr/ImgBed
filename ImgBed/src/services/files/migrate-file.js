import {
  createFileMigrationService,
  createFilesError,
  validateMigrationTarget,
} from './file-migration-service.js';

async function migrateFileRecord(fileRecord, {
  targetChannel,
  targetEntry,
  db,
  storageManager,
  applyPendingQuotaEvents,
  logger,
  preserveSource = false,
  signal = null,
} = {}) {
  const service = createFileMigrationService({
    db,
    storageManager,
    applyPendingQuotaEvents,
    logger,
  });

  return service.migrateFileRecord(fileRecord, {
    targetChannel,
    targetEntry,
    preserveSource,
    signal,
  });
}

async function migrateFilesBatch(files, {
  targetChannel,
  db,
  storageManager,
  applyPendingQuotaEvents,
  logger,
  preserveSource = false,
  signal = null,
} = {}) {
  const service = createFileMigrationService({
    db,
    storageManager,
    applyPendingQuotaEvents,
    logger,
  });

  return service.migrateFilesBatch(files, {
    targetChannel,
    preserveSource,
    signal,
  });
}

export {
  createFileMigrationService,
  createFilesError,
  validateMigrationTarget,
  migrateFileRecord,
  migrateFilesBatch,
};
