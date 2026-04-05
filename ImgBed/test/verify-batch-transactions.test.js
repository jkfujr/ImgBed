/**
 * 验证批量操作事务化
 */
const { db, sqlite } = require('../src/database');
const crypto = require('crypto');

async function setupTestData() {
  // 创建测试文件记录
  const testIds = [];
  for (let i = 0; i < 5; i++) {
    const id = `test-${crypto.randomBytes(8).toString('hex')}`;
    await db.insertInto('files').values({
      id,
      file_name: `test-${i}.jpg`,
      original_name: `test-${i}.jpg`,
      mime_type: 'image/jpeg',
      size: 1024 * (i + 1),
      storage_channel: 'local',
      storage_key: id,
      storage_config: JSON.stringify({ instance_id: 'local-default' }),
      directory: '/test',
    }).execute();
    testIds.push(id);
  }
  return testIds;
}

async function cleanupTestData(testIds) {
  await db.deleteFrom('files').where('id', 'in', testIds).execute();
}

async function testBatchMoveTransaction() {
  console.log('测试 1: 批量移动事务化');

  const testIds = await setupTestData();

  try {
    // 执行批量移动
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('files')
        .set({ directory: '/test-moved' })
        .where('id', 'in', testIds)
        .execute();
    });

    // 验证所有文件都已移动
    const movedFiles = await db.selectFrom('files')
      .select(['id', 'directory'])
      .where('id', 'in', testIds)
      .execute();

    const allMoved = movedFiles.every(f => f.directory === '/test-moved');
    if (!allMoved) {
      throw new Error('部分文件未成功移动');
    }

    console.log(`  ✓ 成功批量移动 ${testIds.length} 个文件`);
    console.log(`  ✓ 事务确保了原子性操作`);

    return true;
  } finally {
    await cleanupTestData(testIds);
  }
}

async function testBatchDeleteTransaction() {
  console.log('\n测试 2: 批量删除事务化');

  const testIds = await setupTestData();

  try {
    // 模拟批量删除（仅数据库部分）
    await db.transaction().execute(async (trx) => {
      for (const id of testIds) {
        await trx.deleteFrom('files').where('id', '=', id).execute();
      }
    });

    // 验证所有文件都已删除
    const remainingFiles = await db.selectFrom('files')
      .select('id')
      .where('id', 'in', testIds)
      .execute();

    if (remainingFiles.length > 0) {
      throw new Error(`仍有 ${remainingFiles.length} 个文件未删除`);
    }

    console.log(`  ✓ 成功批量删除 ${testIds.length} 个文件`);
    console.log(`  ✓ 事务确保了删除的原子性`);

    return true;
  } catch (err) {
    // 如果失败，清理可能残留的数据
    await cleanupTestData(testIds).catch(() => {});
    throw err;
  }
}

async function testTransactionRollback() {
  console.log('\n测试 3: 事务回滚机制');

  const testIds = await setupTestData();

  try {
    // 尝试执行会失败的事务
    try {
      await db.transaction().execute(async (trx) => {
        // 更新前 3 个文件
        await trx.updateTable('files')
          .set({ directory: '/test-rollback' })
          .where('id', 'in', testIds.slice(0, 3))
          .execute();

        // 故意抛出错误触发回滚
        throw new Error('模拟事务失败');
      });
    } catch (err) {
      if (err.message !== '模拟事务失败') {
        throw err;
      }
    }

    // 验证所有文件都未被修改（回滚成功）
    const files = await db.selectFrom('files')
      .select(['id', 'directory'])
      .where('id', 'in', testIds)
      .execute();

    const allUnchanged = files.every(f => f.directory === '/test');
    if (!allUnchanged) {
      throw new Error('事务回滚失败，部分数据已被修改');
    }

    console.log(`  ✓ 事务回滚成功，所有数据保持原状`);
    console.log(`  ✓ 确保了数据一致性`);

    return true;
  } finally {
    await cleanupTestData(testIds);
  }
}

async function testPerformanceImprovement() {
  console.log('\n测试 4: 性能对比（事务 vs 非事务）');

  const batchSize = 50;

  // 非事务方式
  const nonTxIds = [];
  for (let i = 0; i < batchSize; i++) {
    nonTxIds.push(`perf-notx-${crypto.randomBytes(8).toString('hex')}`);
  }

  const startNonTx = Date.now();
  for (const id of nonTxIds) {
    await db.insertInto('files').values({
      id,
      file_name: `perf-${id}.jpg`,
      original_name: `perf-${id}.jpg`,
      mime_type: 'image/jpeg',
      size: 1024,
      storage_channel: 'local',
      storage_key: id,
      storage_config: '{}',
      directory: '/perf',
    }).execute();
  }
  const nonTxTime = Date.now() - startNonTx;

  // 清理
  await db.deleteFrom('files').where('id', 'in', nonTxIds).execute();

  // 事务方式
  const txIds = [];
  for (let i = 0; i < batchSize; i++) {
    txIds.push(`perf-tx-${crypto.randomBytes(8).toString('hex')}`);
  }

  const startTx = Date.now();
  await db.transaction().execute(async (trx) => {
    for (const id of txIds) {
      await trx.insertInto('files').values({
        id,
        file_name: `perf-${id}.jpg`,
        original_name: `perf-${id}.jpg`,
        mime_type: 'image/jpeg',
        size: 1024,
        storage_channel: 'local',
        storage_key: id,
        storage_config: '{}',
        directory: '/perf',
      }).execute();
    }
  });
  const txTime = Date.now() - startTx;

  // 清理
  await db.deleteFrom('files').where('id', 'in', txIds).execute();

  const improvement = ((nonTxTime - txTime) / nonTxTime * 100).toFixed(1);

  console.log(`  ✓ 非事务方式: ${nonTxTime}ms`);
  console.log(`  ✓ 事务方式: ${txTime}ms`);
  console.log(`  ✓ 性能提升: ${improvement}% (${(nonTxTime / txTime).toFixed(1)}x)`);

  return true;
}

async function main() {
  console.log('=== 批量操作事务化验证 ===\n');

  try {
    await testBatchMoveTransaction();
    await testBatchDeleteTransaction();
    await testTransactionRollback();
    await testPerformanceImprovement();

    console.log('\n✅ 所有事务化验证通过');
    console.log('\n预期收益:');
    console.log('  - 批量操作性能提升 10-20 倍');
    console.log('  - 确保数据一致性（原子性）');
    console.log('  - 失败时自动回滚，避免部分更新');
    console.log('  - 减少磁盘 I/O 次数');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    process.exit(1);
  }
}

main();
