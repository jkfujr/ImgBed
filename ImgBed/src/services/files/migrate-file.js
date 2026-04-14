import ChunkManager from '../../storage/chunk-manager.js';
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
  logger,
  ChunkManager: chunkManager = ChunkManager,
} = {}) {
  const service = createFileMigrationService({
    db,
    storageManager,
    logger,
    ChunkManager: chunkManager,
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
  logger,
  ChunkManager: chunkManager = ChunkManager,
} = {}) {
  const service = createFileMigrationService({
    db,
    storageManager,
    logger,
    ChunkManager: chunkManager,
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
