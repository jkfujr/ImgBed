function waitForDelay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createTaskSnapshot(taskName, overrides = {}) {
  return {
    taskName,
    status: 'idle',
    runId: null,
    input: null,
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
    ...overrides,
  };
}

function createMaintenanceTaskExecutor({
  logger = console,
  wait = waitForDelay,
} = {}) {
  const taskStates = new Map();

  function registerTask(taskDefinition = {}) {
    if (!taskDefinition.name || typeof taskDefinition.run !== 'function') {
      throw new Error('维护任务定义缺少 name 或 run');
    }

    const existingState = taskStates.get(taskDefinition.name);
    if (existingState) {
      existingState.definition = taskDefinition;
      return existingState.snapshot;
    }

    const state = {
      definition: taskDefinition,
      runningPromise: null,
      snapshot: createTaskSnapshot(taskDefinition.name),
    };

    taskStates.set(taskDefinition.name, state);
    return state.snapshot;
  }

  function getTaskState(taskName) {
    const state = taskStates.get(taskName);
    if (!state) {
      throw new Error(`未注册的维护任务: ${taskName}`);
    }
    return state;
  }

  async function processTaskItems(taskDefinition, items, processor, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return;
    }

    const concurrency = Math.max(1, Number(options.concurrency ?? taskDefinition.concurrency) || 1);
    const itemDelayMs = Math.max(0, Number(options.itemDelayMs ?? taskDefinition.itemDelayMs) || 0);
    const onResult = typeof options.onResult === 'function' ? options.onResult : null;
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;

        if (currentIndex >= list.length) {
          return;
        }

        const item = list[currentIndex];
        const result = await processor(item, { index: currentIndex });

        if (onResult) {
          await onResult(result, item, { index: currentIndex });
        }

        if (itemDelayMs > 0) {
          await wait(itemDelayMs);
        }
      }
    };

    const workerCount = Math.min(concurrency, list.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  function getSnapshot(taskName) {
    const state = taskStates.get(taskName);
    return state ? state.snapshot : null;
  }

  function start(taskName, input = {}) {
    const state = getTaskState(taskName);

    if (state.runningPromise) {
      logger.info?.({
        taskName,
        runId: state.snapshot.runId,
      }, '维护任务已在运行，复用当前执行');
      return state.snapshot;
    }

    const runId = `${taskName}:${Date.now()}`;
    const runningSnapshot = createTaskSnapshot(taskName, {
      status: 'running',
      runId,
      input,
      startedAt: new Date().toISOString(),
    });

    state.snapshot = runningSnapshot;
    logger.info?.({ taskName, runId, input }, '维护任务开始');

    state.runningPromise = Promise.resolve()
      .then(() => state.definition.run(input, {
        logger,
        taskName,
        runId,
        processItems: (items, processor, options = {}) => processTaskItems(
          state.definition,
          items,
          processor,
          options,
        ),
      }))
      .then((result) => {
        state.snapshot = {
          ...runningSnapshot,
          status: 'completed',
          endedAt: new Date().toISOString(),
          result,
        };

        logger.info?.({ taskName, runId, result }, '维护任务完成');
      })
      .catch((error) => {
        state.snapshot = {
          ...runningSnapshot,
          status: 'failed',
          endedAt: new Date().toISOString(),
          error: {
            name: error?.name || 'Error',
            message: error?.message || String(error),
          },
        };

        logger.error?.({ taskName, runId, err: error }, '维护任务失败');
      })
      .finally(() => {
        state.runningPromise = null;
      });

    return runningSnapshot;
  }

  return {
    registerTask,
    start,
    getSnapshot,
  };
}

export {
  createMaintenanceTaskExecutor,
  waitForDelay,
};
