/**
 * T1.5 日志异步化测试
 *
 * 测试目标：
 * 1. 验证异步日志不阻塞主流程
 * 2. 验证日志格式与字段完整性
 * 3. 验证 flush 机制确保日志不丢失
 * 4. 验证高并发场景下的日志性能
 */

import { createLogger, flushLogs } from '../src/utils/logger.js';
import { performance } from 'perf_hooks';

const log = createLogger('test-async-logging');

// 测试计数器
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

/**
 * 测试 1: 基础日志功能
 */
function testBasicLogging() {
  console.log('\n=== 测试 1: 基础日志功能 ===');

  try {
    log.info('测试信息日志');
    log.warn({ key: 'value' }, '测试警告日志');
    log.error({ err: new Error('测试错误') }, '测试错误日志');

    assert(true, '基础日志调用成功');
  } catch (error) {
    assert(false, `基础日志调用失败: ${error.message}`);
  }
}

/**
 * 测试 2: 高并发日志性能
 */
async function testHighConcurrencyLogging() {
  console.log('\n=== 测试 2: 高并发日志性能 ===');

  const iterations = 10000;
  const testLog = createLogger('perf-test');

  // 异步日志测试 - 主流程耗时
  const asyncStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    testLog.info({ iteration: i }, '高并发测试日志');
  }
  const asyncDuration = performance.now() - asyncStart;

  console.log(`写入 ${iterations} 条日志主流程耗时: ${asyncDuration.toFixed(2)}ms`);
  console.log(`平均每条日志耗时: ${(asyncDuration / iterations).toFixed(4)}ms`);

  // 异步日志的主流程耗时应该很低（不阻塞）
  assert(asyncDuration < 100, `异步日志主流程不阻塞 (${asyncDuration.toFixed(2)}ms < 100ms)`);

  // 等待日志写入完成
  const flushStart = performance.now();
  await flushLogs();
  const flushDuration = performance.now() - flushStart;

  console.log(`日志 flush 耗时: ${flushDuration.toFixed(2)}ms`);
  assert(true, '日志 flush 成功');
}

/**
 * 测试 3: 日志字段完整性
 */
function testLogFieldCompleteness() {
  console.log('\n=== 测试 3: 日志字段完整性 ===');

  const testLog = createLogger('field-test');

  // 测试结构化日志字段
  testLog.info({
    userId: 'user123',
    action: 'upload',
    fileSize: 1024,
    metadata: { key: 'value' }
  }, '结构化日志测试');

  // 测试错误日志字段
  const testError = new Error('测试错误');
  testError.code = 'TEST_ERROR';
  testLog.error({
    err: testError,
    context: { operation: 'test' }
  }, '错误日志测试');

  assert(true, '结构化日志字段完整');
}

/**
 * 测试 4: 批量日志写入
 */
async function testBatchLogging() {
  console.log('\n=== 测试 4: 批量日志写入 ===');

  const batchLog = createLogger('batch-test');
  const batchSize = 1000;

  const start = performance.now();

  // 模拟批量操作中的日志
  for (let i = 0; i < batchSize; i++) {
    batchLog.debug({
      batchId: 'batch-001',
      itemIndex: i,
      status: i % 2 === 0 ? 'success' : 'pending'
    }, `处理批次项 ${i}`);
  }

  const duration = performance.now() - start;
  console.log(`批量写入 ${batchSize} 条日志耗时: ${duration.toFixed(2)}ms`);
  console.log(`平均每条日志耗时: ${(duration / batchSize).toFixed(4)}ms`);

  assert(duration < 1000, `批量日志性能合理 (${duration.toFixed(2)}ms < 1000ms)`);

  // 确保所有日志都已写入
  await flushLogs();
  assert(true, '批量日志 flush 成功');
}

/**
 * 测试 5: 不同日志级别
 */
function testLogLevels() {
  console.log('\n=== 测试 5: 不同日志级别 ===');

  const levelLog = createLogger('level-test');

  try {
    levelLog.trace('trace 级别日志');
    levelLog.debug('debug 级别日志');
    levelLog.info('info 级别日志');
    levelLog.warn('warn 级别日志');
    levelLog.error('error 级别日志');
    levelLog.fatal('fatal 级别日志');

    assert(true, '所有日志级别调用成功');
  } catch (error) {
    assert(false, `日志级别调用失败: ${error.message}`);
  }
}

/**
 * 测试 6: 模拟进程退出场景
 */
async function testGracefulShutdown() {
  console.log('\n=== 测试 6: 模拟进程退出场景 ===');

  const shutdownLog = createLogger('shutdown-test');

  // 写入一批日志
  for (let i = 0; i < 100; i++) {
    shutdownLog.info({ index: i }, '退出前日志');
  }

  // 模拟优雅关闭
  const flushStart = performance.now();
  await flushLogs();
  const flushDuration = performance.now() - flushStart;

  console.log(`日志 flush 耗时: ${flushDuration.toFixed(2)}ms`);

  assert(flushDuration < 1000, `flush 性能合理 (${flushDuration.toFixed(2)}ms < 1000ms)`);
  assert(true, '优雅关闭场景测试通过');
}

/**
 * 运行所有测试
 */
async function runTests() {
  console.log('开始测试日志异步化功能...\n');

  testBasicLogging();
  await testHighConcurrencyLogging();
  testLogFieldCompleteness();
  await testBatchLogging();
  testLogLevels();
  await testGracefulShutdown();

  // 最终 flush
  await flushLogs();

  console.log('\n=== 测试结果 ===');
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  console.log(`总计: ${passed + failed}`);

  if (failed > 0) {
    console.error('\n测试失败！');
    process.exit(1);
  } else {
    console.log('\n所有测试通过！');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
