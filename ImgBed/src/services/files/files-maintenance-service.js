import { createLogger } from '../../utils/logger.js';
import { rebuildMetadataTask } from './rebuild-metadata.js';

function createFilesMaintenanceService({
  db,
  storageManager,
  logger = createLogger('files'),
  rebuildMetadataTaskFn = rebuildMetadataTask,
} = {}) {
  return {
    startMetadataRebuild({
      force = false,
    } = {}) {
      const forceEnabled = force === true || force === 'true';

      Promise.resolve().then(async () => {
        try {
          await rebuildMetadataTaskFn({
            force: forceEnabled,
            db,
            storageManager,
            logger,
          });
        } catch (err) {
          logger.error({ err }, '元数据重建任务崩溃');
        }
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
