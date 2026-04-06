import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('../ImgBed/node_modules/better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test-quota-cache-integration.sqlite');

// 清理旧测试数据库
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const db = new Database(testDbPath);
db.exec('PRAGMA journal_mode = WAL');

console.log('=== 容量缓存表集成测试 ===\n');

let passed = true;

try {
  // 1. 初始化完整数据库结构
  console.log('1. 初始化数据库结构...');
  const initSql = fs.readFileSync(
    path.join(__dirname, '../ImgBed/src/database/index.js'),
    'utf8'
  );

  // 提取 SQL 部分（简化处理，直接执行迁移脚本）
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_instance_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationSql = fs.readFileSync(
    path.join(__dirname, '../ImgBed/database/migrations/001_add_storage_quota_cache.sql'),
    'utf8'
  );
  db.exec(migrationSql);
  console.log('   ✓ 数据库结构初始化完成');

  // 2. 测试插入文件
  console.log('\n2. 测试插入文件...');
  const insertFile = db.prepare('INSERT INTO files (id, file_name, original_name, size, storage_instance_id) VALUES (?, ?, ?, ?, ?)');

  insertFile.run('f1', 'test1.jpg', 'test1.jpg', 1000000, 's3');
  insertFile.run('f2', 'test2.jpg', 'test2.jpg', 2000000, 's3');
  insertFile.run('f3', 'test3.jpg', 'test3.jpg', 500000, 'local-1');

  const cache1 = db.prepare('SELECT * FROM storage_quota_cache ORDER BY storage_id').all();
  console.log('   插入后缓存:', cache1);

  if (cache1.length !== 2) {
    console.log('   ✗ 缓存表记录数错误');
    passed = false;
  } else {
    const s3Cache = cache1.find(c => c.storage_id === 's3');
    const localCache = cache1.find(c => c.storage_id === 'local-1');

    if (s3Cache.used_bytes === 3000000 && s3Cache.file_count === 2) {
      console.log('   ✓ s3 缓存正确');
    } else {
      console.log(`   ✗ s3 缓存错误: ${s3Cache.used_bytes}/${s3Cache.file_count}`);
      passed = false;
    }

    if (localCache.used_bytes === 500000 && localCache.file_count === 1) {
      console.log('   ✓ local-1 缓存正确');
    } else {
      console.log(`   ✗ local-1 缓存错误: ${localCache.used_bytes}/${localCache.file_count}`);
      passed = false;
    }
  }

  // 3. 测试删除文件
  console.log('\n3. 测试删除文件...');
  db.prepare('DELETE FROM files WHERE id = ?').run('f1');

  const cache2 = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
  if (cache2.used_bytes === 2000000 && cache2.file_count === 1) {
    console.log('   ✓ 删除后缓存正确');
  } else {
    console.log(`   ✗ 删除后缓存错误: ${cache2.used_bytes}/${cache2.file_count}`);
    passed = false;
  }

  // 4. 测试更新文件大小
  console.log('\n4. 测试更新文件大小...');
  db.prepare('UPDATE files SET size = ? WHERE id = ?').run(3000000, 'f2');

  const cache3 = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
  if (cache3.used_bytes === 3000000 && cache3.file_count === 1) {
    console.log('   ✓ 更新大小后缓存正确');
  } else {
    console.log(`   ✗ 更新大小后缓存错误: ${cache3.used_bytes}/${cache3.file_count}`);
    passed = false;
  }

  // 5. 测试迁移存储实例
  console.log('\n5. 测试迁移存储实例...');
  db.prepare('UPDATE files SET storage_instance_id = ? WHERE id = ?').run('local-1', 'f2');

  const s3Cache4 = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
  const localCache4 = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('local-1');

  if (s3Cache4.used_bytes === 0 && s3Cache4.file_count === 0) {
    console.log('   ✓ 源存储实例清空正确');
  } else {
    console.log(`   ✗ 源存储实例清空错误: ${s3Cache4.used_bytes}/${s3Cache4.file_count}`);
    passed = false;
  }

  if (localCache4.used_bytes === 3500000 && localCache4.file_count === 2) {
    console.log('   ✓ 目标存储实例增加正确');
  } else {
    console.log(`   ✗ 目标存储实例增加错误: ${localCache4.used_bytes}/${localCache4.file_count}`);
    passed = false;
  }

  // 6. 测试一致性校验
  console.log('\n6. 测试一致性校验...');
  const actualStats = db.prepare(`
    SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
    FROM files
    WHERE storage_instance_id IS NOT NULL
    GROUP BY storage_instance_id
  `).all();

  const cachedStats = db.prepare('SELECT * FROM storage_quota_cache').all();

  let consistent = true;
  for (const actual of actualStats) {
    const cached = cachedStats.find(c => c.storage_id === actual.storage_instance_id);
    if (!cached || cached.used_bytes !== Number(actual.used_bytes) || cached.file_count !== Number(actual.file_count)) {
      consistent = false;
      break;
    }
  }

  if (consistent) {
    console.log('   ✓ 缓存与实际数据一致');
  } else {
    console.log('   ✗ 缓存与实际数据不一致');
    console.log('   实际:', actualStats);
    console.log('   缓存:', cachedStats);
    passed = false;
  }

  // 7. 测试性能对比
  console.log('\n7. 测试性能对比...');

  // 插入更多测试数据
  const insertMany = db.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      insertFile.run(`perf-${i}`, `file${i}.jpg`, `file${i}.jpg`, Math.floor(Math.random() * 10000000), 's3');
    }
  });
  insertMany();

  // 测试缓存查询性能
  const cacheStart = Date.now();
  for (let i = 0; i < 1000; i++) {
    db.prepare('SELECT used_bytes FROM storage_quota_cache WHERE storage_id = ?').get('s3');
  }
  const cacheTime = Date.now() - cacheStart;

  // 测试聚合查询性能
  const aggStart = Date.now();
  for (let i = 0; i < 1000; i++) {
    db.prepare('SELECT SUM(size) AS used_bytes FROM files WHERE storage_instance_id = ?').get('s3');
  }
  const aggTime = Date.now() - aggStart;

  console.log(`   缓存查询 1000 次耗时: ${cacheTime}ms`);
  console.log(`   聚合查询 1000 次耗时: ${aggTime}ms`);
  console.log(`   性能提升: ${(aggTime / cacheTime).toFixed(2)}x`);

  if (cacheTime < aggTime) {
    console.log('   ✓ 缓存查询性能优于聚合查询');
  } else {
    console.log('   ✗ 缓存查询性能未达预期');
    passed = false;
  }

} catch (err) {
  console.error('\n✗ 测试过程中发生错误:', err);
  passed = false;
}

// 清理
db.close();
fs.unlinkSync(testDbPath);

console.log('\n=== 测试结果 ===');
if (passed) {
  console.log('✓ 所有集成测试通过');
  process.exit(0);
} else {
  console.log('✗ 部分集成测试失败');
  process.exit(1);
}
