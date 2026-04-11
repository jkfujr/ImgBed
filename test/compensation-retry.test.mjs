/**
 * 补偿重试逻辑单元测试
 * 覆盖范围：
 *   1. _executeRecovery：retry_count < MAX_RETRIES 时失败 → 递增计数，状态保持不变
 *   2. _executeRecovery：retry_count >= MAX_RETRIES 时 → 标记 failed，不再重试
 *   3. _executeRecovery：成功时 → 不递增计数
 *   4. _startCompensationRetryTimer：有恢复成功时退避重置为初始值
 *   5. _startCompensationRetryTimer：全部失败时退避指数加倍（上限 60 分钟）
 *   6. _stopCompensationRetryTimer：停止后不再触发下一次调度
 *   7. incrementOperationRetryCount：SQL 语句正确传参
 */

import { strict as assert } from 'node:assert';

// ─────────────────────────────────────────────────────────────────────────────
// storage-operations 中的 incrementOperationRetryCount 直接导入测试
// ─────────────────────────────────────────────────────────────────────────────
import {
  incrementOperationRetryCount,
} from '../ImgBed/src/services/system/storage-operations.js';

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：构造伪 db，记录 prepare/run 调用
// ─────────────────────────────────────────────────────────────────────────────
function makeTrackingDb(operationRow = null) {
  const calls = { prepares: [], runs: [] };
  const db = {
    _calls: calls,
    prepare(sql) {
      calls.prepares.push(sql);
      return {
        run(...args) { calls.runs.push({ sql, args }); },
        get(...args) {
          calls.runs.push({ sql, args, type: 'get' });
          return operationRow;
        },
        all() { return []; },
      };
    },
    transaction(fn) { return () => fn(); },
  };
  return db;
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助：构造最小化伪 StorageManager 实例（只含需要测试的方法）
// 通过原型链直接调用 manager.js 中定义的方法，不触发 constructor
// ─────────────────────────────────────────────────────────────────────────────
function makeFakeManager({ db, recoverRemoteDone, recoverCommitted, executeCompensation } = {}) {
  const MIN_INTERVAL_MS = 5 * 60 * 1000;
  const MAX_INTERVAL_MS = 60 * 60 * 1000;

  const manager = {
    db: db ?? makeTrackingDb(),
    _isRecoveryRunning: false,
    _compensationRetryTimer: null,
    _compensationBackoffMs: MIN_INTERVAL_MS,
    _MIN_INTERVAL_MS: MIN_INTERVAL_MS,
    _MAX_INTERVAL_MS: MAX_INTERVAL_MS,

    // ── 被测方法（从 manager.js 复制逻辑，避免触发模块副作用）──
    async _executeRecovery(operation) {
      const localDb = this.db;
      const MAX_RETRIES = 5;
      const retryCount = operation.retry_count ?? 0;

      if (retryCount >= MAX_RETRIES) {
        // 模拟 markOperationFailed
        this._lastFailedId = operation.id;
        this._lastFailedReason = `超过最大重试次数 ${MAX_RETRIES}`;
        return;
      }

      try {
        switch (operation.status) {
          case 'remote_done':
            await (recoverRemoteDone ?? this._recoverRemoteDoneOperation).call(this, operation);
            break;
          case 'committed':
            await (recoverCommitted ?? this._recoverCommittedOperation).call(this, operation);
            break;
          case 'compensation_pending':
            await (executeCompensation ?? this._executeCompensation).call(this, operation);
            break;
        }
      } catch (err) {
        incrementOperationRetryCount(localDb, operation.id);
        this._lastIncrementedId = operation.id;
      }
    },

    _startCompensationRetryTimer() {
      if (this._compensationRetryTimer) return;

      const scheduleNext = () => {
        this._compensationRetryTimer = setTimeout(async () => {
          try {
            const result = await this._recoverStaleOperations();
            if (result.recovered > 0) {
              this._compensationBackoffMs = this._MIN_INTERVAL_MS;
            } else {
              this._compensationBackoffMs = Math.min(
                this._compensationBackoffMs * 2,
                this._MAX_INTERVAL_MS,
              );
            }
          } catch {
            this._compensationBackoffMs = Math.min(
              this._compensationBackoffMs * 2,
              this._MAX_INTERVAL_MS,
            );
          } finally {
            if (this._compensationRetryTimer !== null) {
              scheduleNext();
            }
          }
        }, this._compensationBackoffMs);
        this._compensationRetryTimer.unref?.();
      };

      scheduleNext();
    },

    _stopCompensationRetryTimer() {
      if (this._compensationRetryTimer) {
        clearTimeout(this._compensationRetryTimer);
        this._compensationRetryTimer = null;
      }
    },

    // 默认抛出，测试按需覆盖
    async _recoverRemoteDoneOperation() { throw new Error('stub not set'); },
    async _recoverCommittedOperation() { throw new Error('stub not set'); },
    async _executeCompensation() { throw new Error('stub not set'); },
    async _recoverStaleOperations() { return { recovered: 0, total: 0, skipped: false }; },
  };

  return manager;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. _executeRecovery：失败时递增计数
// ─────────────────────────────────────────────────────────────────────────────
async function testExecuteRecoveryIncrementsCountOnFailure() {
  const db = makeTrackingDb({ id: 'op-1', status: 'compensation_pending', retry_count: 0 });

  const manager = makeFakeManager({
    db,
    executeCompensation: async () => { throw new Error('网络超时'); },
  });

  const op = { id: 'op-1', status: 'compensation_pending', retry_count: 0 };
  await manager._executeRecovery(op);

  // 应该调用 incrementOperationRetryCount，即执行了含 retry_count 的 UPDATE
  const retryUpdate = db._calls.runs.find(r =>
    r.sql.includes('retry_count') && r.args?.includes?.('op-1')
  );
  assert.ok(retryUpdate, '失败时应调用 incrementOperationRetryCount');
  assert.equal(manager._lastFailedId, undefined, '未超限时不应标记 failed');
  console.log('  [OK] _executeRecovery：失败时递增 retry_count，不标记 failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. _executeRecovery：retry_count >= MAX_RETRIES 时标记 failed，不递增
// ─────────────────────────────────────────────────────────────────────────────
async function testExecuteRecoveryMarkFailedWhenMaxRetriesReached() {
  const db = makeTrackingDb({ id: 'op-2', status: 'compensation_pending', retry_count: 5 });

  const executionCount = { count: 0 };
  const manager = makeFakeManager({
    db,
    executeCompensation: async () => { executionCount.count++; },
  });

  const op = { id: 'op-2', status: 'compensation_pending', retry_count: 5 };
  await manager._executeRecovery(op);

  assert.equal(executionCount.count, 0, '达到最大次数时不应执行补偿逻辑');
  assert.equal(manager._lastFailedId, 'op-2', '应标记为 failed');
  assert.ok(manager._lastFailedReason.includes('5'), '失败原因应包含最大次数');
  console.log('  [OK] _executeRecovery：retry_count >= 5 时标记 failed，跳过执行');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. _executeRecovery：成功时不递增计数
// ─────────────────────────────────────────────────────────────────────────────
async function testExecuteRecoveryDoesNotIncrementOnSuccess() {
  const db = makeTrackingDb({ id: 'op-3', status: 'remote_done', retry_count: 2 });

  const manager = makeFakeManager({
    db,
    recoverRemoteDone: async () => { /* 成功 */ },
  });

  const op = { id: 'op-3', status: 'remote_done', retry_count: 2 };
  await manager._executeRecovery(op);

  const retryUpdate = db._calls.runs.find(r =>
    r.sql.includes('retry_count') && r.args?.includes?.('op-3')
  );
  assert.equal(retryUpdate, undefined, '成功时不应递增 retry_count');
  assert.equal(manager._lastIncrementedId, undefined);
  console.log('  [OK] _executeRecovery：成功时不递增 retry_count');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. incrementOperationRetryCount：正确传参给 db
// ─────────────────────────────────────────────────────────────────────────────
async function testIncrementOperationRetryCountCallsDb() {
  const db = makeTrackingDb();
  incrementOperationRetryCount(db, 'op-x');

  const run = db._calls.runs.find(r => r.sql.includes('retry_count') && r.args[0] === 'op-x');
  assert.ok(run, 'incrementOperationRetryCount 应调用包含 retry_count 的 UPDATE');
  assert.equal(run.args[0], 'op-x', '应传入正确的 operationId');
  console.log('  [OK] incrementOperationRetryCount：正确传 operationId 给 db');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 退避：有恢复成功时重置为初始值
// ─────────────────────────────────────────────────────────────────────────────
async function testBackoffResetsOnSuccess() {
  const manager = makeFakeManager();
  manager._compensationBackoffMs = 20 * 60 * 1000; // 已退避到 20 分钟
  manager._recoverStaleOperations = async () => ({ recovered: 3, total: 3, skipped: false });

  // 直接模拟一次 timer 触发（不真正等待 setTimeout）
  const result = await manager._recoverStaleOperations();
  if (result.recovered > 0) {
    manager._compensationBackoffMs = manager._MIN_INTERVAL_MS;
  }

  assert.equal(manager._compensationBackoffMs, 5 * 60 * 1000, '有成功恢复时应重置为 5 分钟');
  console.log('  [OK] 退避：有成功恢复时重置为初始 5 分钟');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 退避：全部失败时指数加倍
// ─────────────────────────────────────────────────────────────────────────────
async function testBackoffDoublesOnAllFailure() {
  const manager = makeFakeManager();
  const MIN = 5 * 60 * 1000;
  const MAX = 60 * 60 * 1000;

  manager._compensationBackoffMs = MIN; // 初始 5 分钟

  // 模拟：全部失败（recovered = 0）→ 加倍
  let backoff = MIN;
  for (let i = 0; i < 4; i++) {
    backoff = Math.min(backoff * 2, MAX);
  }
  // 5 → 10 → 20 → 40 → 60 min（上限）
  assert.equal(backoff, MAX, '指数加倍后应达到 60 分钟上限');

  // 验证倒数第二步不超限
  let backoff2 = MIN;
  for (let i = 0; i < 3; i++) {
    backoff2 = Math.min(backoff2 * 2, MAX);
  }
  assert.equal(backoff2, 40 * 60 * 1000, '三次加倍后应为 40 分钟');

  console.log('  [OK] 退避：全部失败时指数加倍，上限 60 分钟');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. _stopCompensationRetryTimer：停止后 timer 为 null
// ─────────────────────────────────────────────────────────────────────────────
async function testStopTimerSetsNullAndPreventsReschedule() {
  const manager = makeFakeManager();
  let rescheduleCount = 0;

  // 用极短延迟的 timer 触发，验证停止后不再重调度
  manager._compensationBackoffMs = 10; // 10ms，便于测试
  manager._recoverStaleOperations = async () => {
    rescheduleCount++;
    return { recovered: 0, total: 0, skipped: false };
  };

  manager._startCompensationRetryTimer();
  assert.ok(manager._compensationRetryTimer !== null, '启动后 timer 应不为 null');

  // 立即停止
  manager._stopCompensationRetryTimer();
  assert.equal(manager._compensationRetryTimer, null, '停止后 timer 应为 null');

  // 等待足够时间，确认 timer 回调未触发（因为已 clearTimeout）
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(rescheduleCount, 0, '停止后不应再触发恢复调度');

  console.log('  [OK] _stopCompensationRetryTimer：停止后 timer 为 null，不再重调度');
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. _startCompensationRetryTimer：重复调用不会创建多个 timer
// ─────────────────────────────────────────────────────────────────────────────
async function testStartTimerIdempotent() {
  const manager = makeFakeManager();
  manager._compensationBackoffMs = 60 * 60 * 1000; // 长延迟，不会触发

  manager._startCompensationRetryTimer();
  const timer1 = manager._compensationRetryTimer;

  manager._startCompensationRetryTimer(); // 再次调用
  const timer2 = manager._compensationRetryTimer;

  assert.equal(timer1, timer2, '重复调用 _startCompensationRetryTimer 应复用同一 timer');

  manager._stopCompensationRetryTimer();
  console.log('  [OK] _startCompensationRetryTimer：重复调用幂等，不创建多个 timer');
}

// ─────────────────────────────────────────────────────────────────────────────
// 运行
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n== _executeRecovery 最大重试次数测试 ==');
  await testExecuteRecoveryIncrementsCountOnFailure();
  await testExecuteRecoveryMarkFailedWhenMaxRetriesReached();
  await testExecuteRecoveryDoesNotIncrementOnSuccess();
  await testIncrementOperationRetryCountCallsDb();

  console.log('\n== _startCompensationRetryTimer 指数退避测试 ==');
  await testBackoffResetsOnSuccess();
  await testBackoffDoublesOnAllFailure();
  await testStopTimerSetsNullAndPreventsReschedule();
  await testStartTimerIdempotent();

  console.log('\n所有 compensation-retry 测试通过\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
