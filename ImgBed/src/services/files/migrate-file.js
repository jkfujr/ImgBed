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
  });
}

async function migrateFilesBatch(files, {
  targetChannel,
  db,
  storageManager,
  applyPendingQuotaEvents,
  logger,
} = {}) {
  const service = createFileMigrationService({
    db,
    storageManager,
    applyPendingQuotaEvents,
    logger,
  });

  return service.migrateFilesBatch(files, {
    targetChannel,
  });
}

export {
  createFileMigrationService,
  createFilesError,
  validateMigrationTarget,
  migrateFileRecord,
  migrateFilesBatch,
};
