import assert from 'node:assert/strict';
import test from 'node:test';

import { createMaintenanceTaskExecutor } from '../../src/services/maintenance/maintenance-task-executor.js';
import { createFilesMaintenanceService } from '../../src/services/files/files-maintenance-service.js';
import { createMaintenanceService } from '../../src/services/system/maintenance-service.js';
import { createLoggerDouble } from '../helpers/runtime-test-helpers.mjs';

test('createMaintenanceTaskExecutor 会对同名任务执行单飞并在完成后更新快照', async () => {
  const { logger } = createLoggerDouble();
  const executor = createMaintenanceTaskExecutor({
    logger,
    wait: async () => {},
  });
  let runCount = 0;
  let resolveRun = null;

  executor.registerTask({
    name: 'demo-task',
    async run(input) {
      runCount += 1;
      await new Promise((resolve) => {
        resolveRun = resolve;
      });
      return { input };
    },
  });

  const firstSnapshot = executor.start('demo-task', { round: 1 });
  const secondSnapshot = executor.start('demo-task', { round: 2 });
  await Promise.resolve();

  assert.equal(firstSnapshot.runId, secondSnapshot.runId);
  assert.equal(runCount, 1);
  assert.equal(executor.getSnapshot('demo-task').status, 'running');

  resolveRun();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const completedSnapshot = executor.getSnapshot('demo-task');
  assert.equal(completedSnapshot.status, 'completed');
  assert.deepEqual(completedSnapshot.result, {
    input: { round: 1 },
  });
});

test('createMaintenanceTaskExecutor 会在任务失败后保留失败快照', async () => {
  const { logger } = createLoggerDouble();
  const executor = createMaintenanceTaskExecutor({
    logger,
    wait: async () => {},
  });

  executor.registerTask({
    name: 'failing-task',
    async run() {
      throw new Error('task failed');
    },
  });

  executor.start('failing-task');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshot = executor.getSnapshot('failing-task');
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.error.message, 'task failed');
});

test('files 与 system 维护服务可以复用同一个维护任务执行器实例', async () => {
  const { logger } = createLoggerDouble();
  const executor = createMaintenanceTaskExecutor({
    logger,
    wait: async () => {},
  });
  const filesCalls = [];
  const systemCalls = [];

  const filesService = createFilesMaintenanceService({
    db: {},
    storageManager: {},
    logger,
    taskExecutor: executor,
    rebuildMetadataTaskDefinition: {
      name: 'rebuild-metadata',
      async run(input) {
        filesCalls.push(input);
        return { updated: true };
      },
    },
  });

  const systemService = createMaintenanceService({
    db: {
      prepare() {
        return {
          all() {
            return [];
          },
        };
      },
    },
    storageManager: {},
    logger,
    taskExecutor: executor,
    rebuildQuotaStatsTaskDefinition: {
      name: 'rebuild-quota-stats',
      async run() {
        systemCalls.push('quota');
        return { rebuilt: true };
      },
    },
  });

  filesService.startMetadataRebuild({ force: 'true' });
  systemService.triggerQuotaStatsRebuild();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(filesCalls, [{
    force: true,
  }]);
  assert.deepEqual(systemCalls, ['quota']);
  assert.equal(executor.getSnapshot('rebuild-metadata').status, 'completed');
  assert.equal(executor.getSnapshot('rebuild-quota-stats').status, 'completed');
});
