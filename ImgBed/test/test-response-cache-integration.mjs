import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== 响应缓存集成测试 ===\n');

let passed = true;

try {
  // 动态导入模块
  const { initResponseCache, getResponseCache } = await import('../src/services/cache/response-cache.js');
  const { cacheInvalidation } = await import('../src/middleware/cache.js');

  // 1. 测试缓存初始化
  console.log('1. 测试缓存初始化...');
  initResponseCache({
    enabled: true,
    ttlSeconds: 30,
    maxKeys: 100
  });

  const cache = getResponseCache();
  if (cache && cache.enabled) {
    console.log('   ✓ 缓存服务初始化成功');
  } else {
    console.log('   ✗ 缓存服务初始化失败');
    passed = false;
  }

  // 2. 模拟文件列表缓存场景
  console.log('\n2. 模拟文件列表缓存场景...');

  // 模拟第一次请求（缓存未命中）
  const listKey1 = cache.buildKey('files:list', { page: '1', pageSize: '20', directory: '', search: '' });
  const cachedList1 = cache.get(listKey1);

  if (cachedList1 === null) {
    console.log('   ✓ 首次请求缓存未命中');
  } else {
    console.log('   ✗ 首次请求应该缓存未命中');
    passed = false;
  }

  // 模拟数据库查询结果并缓存
  const mockListResponse = {
    code: 0,
    message: 'success',
    data: {
      list: [
        { id: 'file1', file_name: 'test1.jpg', size: 1024 },
        { id: 'file2', file_name: 'test2.jpg', size: 2048 }
      ],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 }
    }
  };
  cache.set(listKey1, mockListResponse);

  // 模拟第二次请求（缓存命中）
  const cachedList2 = cache.get(listKey1);
  if (cachedList2 && cachedList2.data.list.length === 2) {
    console.log('   ✓ 第二次请求缓存命中');
  } else {
    console.log('   ✗ 第二次请求应该缓存命中');
    passed = false;
  }

  // 3. 模拟系统配置缓存场景
  console.log('\n3. 模拟系统配置缓存场景...');

  const configKey = cache.buildKey('system:config', {});
  const mockConfigResponse = {
    code: 0,
    message: 'success',
    data: {
      server: { port: 3000 },
      storage: { default: 'local-1' }
    }
  };

  cache.set(configKey, mockConfigResponse);
  const cachedConfig = cache.get(configKey);

  if (cachedConfig && cachedConfig.data.server.port === 3000) {
    console.log('   ✓ 系统配置缓存正常');
  } else {
    console.log('   ✗ 系统配置缓存失败');
    passed = false;
  }

  // 4. 测试缓存失效场景
  console.log('\n4. 测试缓存失效场景...');

  // 模拟上传文件后使文件列表缓存失效
  cacheInvalidation.invalidateFiles();
  const afterInvalidate = cache.get(listKey1);

  if (afterInvalidate === null) {
    console.log('   ✓ 文件列表缓存失效成功');
  } else {
    console.log('   ✗ 文件列表缓存失效失败');
    passed = false;
  }

  // 配置缓存应该仍然存在
  const configStillCached = cache.get(configKey);
  if (configStillCached !== null) {
    console.log('   ✓ 其他缓存不受影响');
  } else {
    console.log('   ✗ 其他缓存不应该被清除');
    passed = false;
  }

  // 5. 测试存储相关缓存失效
  console.log('\n5. 测试存储相关缓存失效...');

  const storagesKey = cache.buildKey('system:storages', {});
  const quotaKey = cache.buildKey('system:quota-stats', {});

  cache.set(storagesKey, { code: 0, data: { list: [] } });
  cache.set(quotaKey, { code: 0, data: { stats: {} } });

  cacheInvalidation.invalidateStorages();

  const storagesAfter = cache.get(storagesKey);
  const quotaAfter = cache.get(quotaKey);

  if (storagesAfter === null && quotaAfter === null) {
    console.log('   ✓ 存储相关缓存全部失效');
  } else {
    console.log('   ✗ 存储相关缓存失效不完整');
    passed = false;
  }

  // 6. 测试缓存统计
  console.log('\n6. 测试缓存统计...');

  const stats = cache.getStats();
  console.log(`   当前缓存键数: ${stats.currentKeys}`);
  console.log(`   缓存命中率: ${stats.hitRate}`);
  console.log(`   总命中次数: ${stats.hits}`);
  console.log(`   总未命中次数: ${stats.misses}`);

  if (stats.currentKeys >= 0 && stats.hits >= 0 && stats.misses >= 0) {
    console.log('   ✓ 缓存统计信息正常');
  } else {
    console.log('   ✗ 缓存统计信息异常');
    passed = false;
  }

  // 7. 测试不同参数生成不同缓存
  console.log('\n7. 测试不同参数生成不同缓存...');

  const listKeyPage1 = cache.buildKey('files:list', { page: '1', pageSize: '20' });
  const listKeyPage2 = cache.buildKey('files:list', { page: '2', pageSize: '20' });

  cache.set(listKeyPage1, { code: 0, data: { page: 1 } });
  cache.set(listKeyPage2, { code: 0, data: { page: 2 } });

  const page1Data = cache.get(listKeyPage1);
  const page2Data = cache.get(listKeyPage2);

  if (page1Data.data.page === 1 && page2Data.data.page === 2) {
    console.log('   ✓ 不同参数正确隔离缓存');
  } else {
    console.log('   ✗ 不同参数缓存隔离失败');
    passed = false;
  }

  // 8. 测试全局缓存清空
  console.log('\n8. 测试全局缓存清空...');

  cacheInvalidation.invalidateAll();
  const statsAfterClear = cache.getStats();

  if (statsAfterClear.currentKeys === 0) {
    console.log('   ✓ 全局缓存清空成功');
  } else {
    console.log(`   ✗ 全局缓存清空失败: 剩余 ${statsAfterClear.currentKeys} 个键`);
    passed = false;
  }

  // 清理
  cache.destroy();

} catch (err) {
  console.error('\n✗ 测试过程中发生错误:', err);
  passed = false;
}

console.log('\n=== 测试结果 ===');
if (passed) {
  console.log('✓ 所有集成测试通过');
  process.exit(0);
} else {
  console.log('✗ 部分集成测试失败');
  process.exit(1);
}
