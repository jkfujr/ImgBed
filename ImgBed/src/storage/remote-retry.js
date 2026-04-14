function waitForDelay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runRemoteRetry({
  execute,
  shouldRetry,
  maxRetries = 0,
  maxTotalDelayMs = Infinity,
  wait = waitForDelay,
  logger = null,
  logContext = {},
  logMessage = '远端请求失败，准备重试',
} = {}) {
  if (typeof execute !== 'function') {
    throw new Error('runRemoteRetry 缺少 execute');
  }

  let totalDelayMs = 0;

  for (let attempt = 0; ; attempt++) {
    let outcome;
    try {
      outcome = {
        value: await execute({ attempt, totalDelayMs }),
        error: null,
      };
    } catch (error) {
      outcome = {
        value: null,
        error,
      };
    }

    const decision = typeof shouldRetry === 'function'
      ? await shouldRetry(outcome, { attempt, totalDelayMs, maxRetries })
      : { retry: false };

    if (!decision?.retry) {
      if (outcome.error) {
        throw outcome.error;
      }
      return outcome.value;
    }

    const delayMs = Math.max(0, Number(decision.delayMs) || 0);
    const exceedsRetryLimit = attempt >= maxRetries;
    const exceedsDelayBudget = (totalDelayMs + delayMs) > maxTotalDelayMs;

    if (exceedsRetryLimit || exceedsDelayBudget) {
      if (outcome.error) {
        throw outcome.error;
      }
      return outcome.value;
    }

    if (typeof decision.beforeRetry === 'function') {
      await decision.beforeRetry();
    }

    if (logger?.warn) {
      logger.warn({
        ...logContext,
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        totalDelayMs: totalDelayMs + delayMs,
        reason: decision.reason || 'retry',
      }, logMessage);
    }

    if (delayMs > 0) {
      await wait(delayMs);
      totalDelayMs += delayMs;
    }
  }
}

export {
  runRemoteRetry,
  waitForDelay,
};
