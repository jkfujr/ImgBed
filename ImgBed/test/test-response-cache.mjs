import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== 响应缓存功能测试 ===\n');

let passed = true;

try {
  // 动态导入 ResponseCache 类
  const { default: ResponseCache } = await import('../src/services/cache/response-cache.js');

  // 1. 测试缓存基本功能
  console.log('1. 测试缓存基本功能...');
  const cache = new ResponseCache({
    enabled: true,
    ttlSeconds: 2,
    maxKeys: 5
  });

  // 测试 set 和 get
  cache.set('test:key1', { data: 'value1' });
  const value1 = cache.get('test:key1');
  if (value1 && value1.data === 'value1') {
    console.log('   ✓ 缓存设置和获取正常');
  } else {
    console.log('   ✗ 缓存设置和获取失败');
    passed = false;
  }

  // 测试缓存未命中
  const value2 = cache.get('test:nonexistent');
  if (value2 === null) {
    console.log('   ✓ 缓存未命中返回 null');
  } else {
    console.log('   ✗ 缓存未命中应返回 null');
    passed = false;
  }

  // 2. 测试缓存键生成
  console.log('\n2. 测试缓存键生成...');
  const key1 = cache.buildKey('files:list', { page: 1, pageSize: 20, directory: '/test' });
  const key2 = cache.buildKey('files:list', { page: 1, pageSize: 20, directory: '/test' });
  const key3 = cache.buildKey('files:list', { page: 2, pageSize: 20, directory: '/test' });

  if (key1 === key2) {
    console.log('   ✓ 相同参数生成相同缓存键');
  } else {
    console.log('   ✗ 相同参数应生成相同缓存键');
    passed = false;
  }

  if (key1 !== key3) {
    console.log('   ✓ 不同参数生成不同缓存键');
  } else {
    console.log('   ✗ 不同参数应生成不同缓存键');
    passed = false;
  }

  // 测试布尔值和空值标准化
  const keyWithNull = cache.buildKey('test', { param: null });
  const keyWithUndefined = cache.buildKey('test', { param: undefined });
  if (keyWithNull === keyWithUndefined) {
    console.log('   ✓ null 和 undefined 标准化为相同值');
  } else {
    console.log('   ✗ null 和 undefined 应标准化为相同值');
    passed = false;
  }

  const keyWithTrue = cache.buildKey('test', { flag: true });
  const keyWithFalse = cache.buildKey('test', { flag: false });
  if (keyWithTrue !== keyWithFalse) {
    console.log('   ✓ 布尔值正确标准化');
  } else {
    console.log('   ✗ 布尔值应正确标准化');
    passed = false;
  }

  // 3. 测试 TTL 过期
  console.log('\n3. 测试 TTL 过期...');
  cache.set('test:expire', { data: 'will expire' }, 1);
  const beforeExpire = cache.get('test:expire');
  if (beforeExpire && beforeExpire.data === 'will expire') {
    console.log('   ✓ 过期前可以获取缓存');
  } else {
    console.log('   ✗ 过期前应该可以获取缓存');
    passed = false;
  }

  // 等待过期
  await new Promise(resolve => setTimeout(resolve, 1100));
  const afterExpire = cache.get('test:expire');
  if (afterExpire === null) {
    console.log('   ✓ 过期后缓存自动失效');
  } else {
    console.log('   ✗ 过期后缓存应该失效');
    passed = false;
  }

  // 4. 测试删除功能
  console.log('\n4. 测试删除功能...');
  const deleteCache = new ResponseCache({ enabled: true, ttlSeconds: 60, maxKeys: 100 });

  deleteCache.set('test:delete1', { data: 'value1' });
  deleteCache.set('test:delete2', { data: 'value2' });
  deleteCache.set('other:key', { data: 'value3' });

  deleteCache.delete('test:delete1');
  if (deleteCache.get('test:delete1') === null) {
    console.log('   ✓ 单个键删除成功');
  } else {
    console.log('   ✗ 单个键删除失败');
    passed = false;
  }

  const deletedCount = deleteCache.deleteByPrefix('test:');
  if (deletedCount === 1 && deleteCache.get('test:delete2') === null && deleteCache.get('other:key') !== null) {
    console.log('   ✓ 按前缀批量删除成功');
  } else {
    console.log(`   ✗ 按前缀批量删除失败 (删除了 ${deletedCount} 个键)`);
    passed = false;
  }

  deleteCache.destroy();

  // 5. 测试最大键数量限制
  console.log('\n5. 测试最大键数量限制...');
  const smallCache = new ResponseCache({
    enabled: true,
    ttlSeconds: 60,
    maxKeys: 3
  });

  smallCache.set('key1', 'value1');
  smallCache.set('key2', 'value2');
  smallCache.set('key3', 'value3');

  const statsBefore = smallCache.getStats();
  if (statsBefore.currentKeys === 3) {
    console.log('   ✓ 缓存键数量正确');
  } else {
    console.log(`   ✗ 缓存键数量错误: ${statsBefore.currentKeys}`);
    passed = false;
  }

  // 添加第4个键，应该驱逐最旧的
  smallCache.set('key4', 'value4');
  const statsAfter = smallCache.getStats();
  if (statsAfter.currentKeys === 3 && statsAfter.evictions === 1) {
    console.log('   ✓ 超过最大键数量时自动驱逐');
  } else {
    console.log(`   ✗ 驱逐逻辑错误: currentKeys=${statsAfter.currentKeys}, evictions=${statsAfter.evictions}`);
    passed = false;
  }

  // 6. 测试统计信息
  console.log('\n6. 测试统计信息...');
  const statsCache = new ResponseCache({ enabled: true, ttlSeconds: 60, maxKeys: 100 });

  statsCache.set('stat:key1', 'value1');
  statsCache.get('stat:key1'); // 命中
  statsCache.get('stat:key1'); // 命中
  statsCache.get('stat:nonexistent'); // 未命中

  const stats = statsCache.getStats();
  if (stats.hits === 2 && stats.misses === 1 && stats.sets === 1) {
    console.log('   ✓ 统计信息正确');
    console.log(`      命中率: ${stats.hitRate}`);
  } else {
    console.log(`   ✗ 统计信息错误: hits=${stats.hits}, misses=${stats.misses}, sets=${stats.sets}`);
    passed = false;
  }

  // 7. 测试禁用缓存
  console.log('\n7. 测试禁用缓存...');
  const disabledCache = new ResponseCache({ enabled: false });

  disabledCache.set('disabled:key', 'value');
  const disabledValue = disabledCache.get('disabled:key');
  if (disabledValue === null) {
    console.log('   ✓ 禁用缓存时 set/get 不生效');
  } else {
    console.log('   ✗ 禁用缓存时 set/get 应该不生效');
    passed = false;
  }

  // 8. 测试清空缓存
  console.log('\n8. 测试清空缓存...');
  const clearCache = new ResponseCache({ enabled: true, ttlSeconds: 60, maxKeys: 100 });

  clearCache.set('clear:key1', 'value1');
  clearCache.set('clear:key2', 'value2');
  clearCache.clear();

  const clearStats = clearCache.getStats();
  if (clearStats.currentKeys === 0) {
    console.log('   ✓ 清空缓存成功');
  } else {
    console.log(`   ✗ 清空缓存失败: currentKeys=${clearStats.currentKeys}`);
    passed = false;
  }

  // 清理
  cache.destroy();
  smallCache.destroy();
  statsCache.destroy();
  disabledCache.destroy();
  clearCache.destroy();

} catch (err) {
  console.error('\n✗ 测试过程中发生错误:', err);
  passed = false;
}

console.log('\n=== 测试结果 ===');
if (passed) {
  console.log('✓ 所有测试通过');
  process.exit(0);
} else {
  console.log('✗ 部分测试失败');
  process.exit(1);
}
