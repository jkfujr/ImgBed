import assert from 'node:assert/strict';
import test from 'node:test';

import { runRemoteRetry } from '../../src/storage/remote-retry.js';

test('共享远端重试原语可在异常场景下按计划重试并成功返回', async () => {
  let attemptCount = 0;
  const waitCalls = [];

  const result = await runRemoteRetry({
    execute: async () => {
      attemptCount += 1;
      if (attemptCount < 3) {
        throw new Error(`第 ${attemptCount} 次失败`);
      }

      return 'ok';
    },
    shouldRetry: ({ error }, { attempt }) => {
      if (!error) {
        return { retry: false };
      }

      return {
        retry: true,
        delayMs: 100 * (attempt + 1),
        reason: 'temporary_error',
      };
    },
    maxRetries: 3,
    wait: async (delayMs) => {
      waitCalls.push(delayMs);
    },
  });

  assert.equal(result, 'ok');
  assert.equal(attemptCount, 3);
  assert.deepEqual(waitCalls, [100, 200]);
});

test('共享远端重试原语在超出总等待预算后停止重试', async () => {
  let attemptCount = 0;
  const waitCalls = [];

  const result = await runRemoteRetry({
    execute: async () => {
      attemptCount += 1;
      return { status: 'pending', attemptCount };
    },
    shouldRetry: ({ value }) => {
      if (value?.status !== 'pending') {
        return { retry: false };
      }

      return {
        retry: true,
        delayMs: 3000,
        reason: 'waiting_remote_completion',
      };
    },
    maxRetries: 5,
    maxTotalDelayMs: 4000,
    wait: async (delayMs) => {
      waitCalls.push(delayMs);
    },
  });

  assert.equal(attemptCount, 2);
  assert.deepEqual(waitCalls, [3000]);
  assert.deepEqual(result, { status: 'pending', attemptCount: 2 });
});
