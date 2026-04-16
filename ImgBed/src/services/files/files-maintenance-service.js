import { createLogger } from '../../utils/logger.js';
import { defaultMaintenanceTaskExecutor } from '../maintenance/default-maintenance-task-executor.js';
import {
  createRebuildMetadataTaskDefinition,
  REBUILD_METADATA_TASK_NAME,
} from './rebuild-metadata.js';

function createFilesMaintenanceService({
  db,
  storageManager,
  logger = createLogger('files'),
  taskExecutor = defaultMaintenanceTaskExecutor,
  rebuildMetadataTaskDefinition = null,
} = {}) {
  const taskDefinition = rebuildMetadataTaskDefinition || createRebuildMetadataTaskDefinition({
    db,
    storageManager,
    logger,
  });

  taskExecutor.registerTask(taskDefinition);

  return {
    startMetadataRebuild({
      force = false,
    } = {}) {
      const forceEnabled = force === true || force === 'true';

      taskExecutor.start(REBUILD_METADATA_TASK_NAME, {
        force: forceEnabled,
      });

      return {
        status: 'processing',
      };
    },
  };
}

export {
  createFilesMaintenanceService,
};
