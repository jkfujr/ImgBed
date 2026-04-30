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

class TaskStopError extends Error {
  constructor(action, reason) {
    super(reason || (action === 'cancel' ? '任务已取消' : '任务已暂停'));
    this.name = 'TaskStopError';
    this.action = action;
    this.status = action === 'cancel' ? 'cancelled' : 'paused';
  }
}

function createTaskControl() {
  return {
    stopAction: null,
    stopReason: null,
    abortHandlers: new Set(),
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
      control: null,
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

  function buildTaskRuntime(state, taskName, runId) {
    function getStopRequest() {
      return state.control?.stopAction
        ? {
            action: state.control.stopAction,
            status: state.control.stopAction === 'cancel' ? 'cancelled' : 'paused',
            reason: state.control.stopReason,
          }
        : null;
    }

    function throwIfStopRequested() {
      const stopRequest = getStopRequest();
      if (stopRequest) {
        throw new TaskStopError(stopRequest.action, stopRequest.reason);
      }
    }

    function addAbortHandler(handler) {
      if (typeof handler !== 'function' || !state.control) {
        return () => {};
      }

      state.control.abortHandlers.add(handler);
      return () => {
        state.control?.abortHandlers.delete(handler);
      };
    }

    async function processItems(items, processor, options = {}) {
      return processTaskItems(state.definition, items, processor, {
        ...options,
        throwIfStopRequested,
      });
    }

    return {
      logger,
      taskName,
      runId,
      processItems,
      getStopRequest,
      isStopRequested: () => Boolean(getStopRequest()),
      throwIfStopRequested,
      addAbortHandler,
    };
  }

  async function processTaskItems(taskDefinition, items, processor, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return;
    }

    const concurrency = Math.max(1, Number(options.concurrency ?? taskDefinition.concurrency) || 1);
    const itemDelayMs = Math.max(0, Number(options.itemDelayMs ?? taskDefinition.itemDelayMs) || 0);
    const onResult = typeof options.onResult === 'function' ? options.onResult : null;
    const throwIfStopRequested = typeof options.throwIfStopRequested === 'function'
      ? options.throwIfStopRequested
      : () => {};
    let cursor = 0;

    const worker = async () => {
      while (true) {
        throwIfStopRequested();
        const currentIndex = cursor;
        cursor += 1;

        if (currentIndex >= list.length) {
          return;
        }

        const item = list[currentIndex];
        throwIfStopRequested();
        const result = await processor(item, { index: currentIndex });
        throwIfStopRequested();

        if (onResult) {
          await onResult(result, item, { index: currentIndex });
        }

        throwIfStopRequested();
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

  function requestStop(taskName, {
    action,
    reason = null,
  } = {}) {
    if (action !== 'pause' && action !== 'cancel') {
      throw new Error(`不支持的任务停止动作: ${action}`);
    }

    const state = getTaskState(taskName);
    if (!state.runningPromise || !state.control) {
      return state.snapshot;
    }

    if (!state.control.stopAction) {
      state.control.stopAction = action;
      state.control.stopReason = reason || (action === 'cancel' ? '用户取消任务' : '用户暂停任务');
    }

    for (const handler of state.control.abortHandlers) {
      try {
        handler(state.control.stopReason);
      } catch (error) {
        logger.warn?.({ taskName, err: error }, '维护任务停止回调执行失败');
      }
    }

    const status = action === 'cancel' ? 'cancelled' : 'paused';
    state.snapshot = {
      ...state.snapshot,
      status,
      error: {
        name: 'TaskStopError',
        message: state.control.stopReason,
      },
    };

    logger.info?.({
      taskName,
      runId: state.snapshot.runId,
      action,
      reason: state.control.stopReason,
    }, '维护任务收到停止请求');

    return state.snapshot;
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
    state.control = createTaskControl();
    logger.info?.({ taskName, runId, input }, '维护任务开始');

    state.runningPromise = Promise.resolve()
      .then(() => state.definition.run(input, buildTaskRuntime(state, taskName, runId)))
      .then((result) => {
        const stopRequest = state.control?.stopAction
          ? {
              status: state.control.stopAction === 'cancel' ? 'cancelled' : 'paused',
              reason: state.control.stopReason,
            }
          : null;

        if (stopRequest) {
          state.snapshot = {
            ...runningSnapshot,
            status: stopRequest.status,
            endedAt: new Date().toISOString(),
            result,
            error: {
              name: 'TaskStopError',
              message: stopRequest.reason,
            },
          };
          logger.info?.({ taskName, runId, result }, '维护任务已停止');
          return;
        }

        state.snapshot = {
          ...runningSnapshot,
          status: 'completed',
          endedAt: new Date().toISOString(),
          result,
        };

        logger.info?.({ taskName, runId, result }, '维护任务完成');
      })
      .catch((error) => {
        if (error instanceof TaskStopError) {
          state.snapshot = {
            ...runningSnapshot,
            status: error.status,
            endedAt: new Date().toISOString(),
            error: {
              name: error.name,
              message: error.message,
            },
          };

          logger.info?.({ taskName, runId, action: error.action }, '维护任务已停止');
          return;
        }

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
        state.control = null;
      });

    return runningSnapshot;
  }

  return {
    registerTask,
    start,
    getSnapshot,
    requestStop,
  };
}

export {
  TaskStopError,
  createMaintenanceTaskExecutor,
  waitForDelay,
};
