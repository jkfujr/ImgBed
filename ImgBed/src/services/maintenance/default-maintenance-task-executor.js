import { createLogger } from '../../utils/logger.js';
import { createMaintenanceTaskExecutor } from './maintenance-task-executor.js';

const defaultMaintenanceTaskExecutor = createMaintenanceTaskExecutor({
  logger: createLogger('maintenance'),
});

export {
  defaultMaintenanceTaskExecutor,
};
