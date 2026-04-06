import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('../node_modules/better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test-quota-cache.sqlite');

// 清理旧测试数据库
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const db = new Database(testDbPath);
db.exec('PRAGMA journal_mode = WAL');

console.log('=== 容量缓存表迁移测试 ===\n');

// 创建基础表结构
console.log('1. 创建基础 files 表...');
db.exec(`
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_instance_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 执行迁移（在插入数据之前）
console.log('2. 执行迁移脚本...');
const migrationSql = fs.readFileSync(
  path.join(__dirname, '../database/migrations/001_add_storage_quota_cache.sql'),
  'utf8'
);
db.exec(migrationSql);
console.log('   ✓ 迁移完成');

// 插入测试数据（迁移后，触发器会自动维护缓存）
console.log('\n3. 插入测试数据...');
const insertFile = db.prepare('INSERT INTO files (id, file_name, original_name, size, storage_instance_id) VALUES (?, ?, ?, ?, ?)');
insertFile.run('file1', 'test1.jpg', 'test1.jpg', 1024000, 's3');
insertFile.run('file2', 'test2.jpg', 'test2.jpg', 2048000, 's3');
insertFile.run('file3', 'test3.jpg', 'test3.jpg', 512000, 'local-1');
insertFile.run('file4', 'test4.jpg', 'test4.jpg', 768000, 'local-1');

// 验证初始数据
const initialStats = db.prepare(`
  SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
  FROM files
  WHERE storage_instance_id IS NOT NULL
  GROUP BY storage_instance_id
`).all();

console.log('   初始统计:', initialStats);

// 验证缓存表数据
console.log('\n4. 验证缓存表初始化...');
const cacheStats = db.prepare('SELECT * FROM storage_quota_cache ORDER BY storage_id').all();
console.log('   缓存表数据:', cacheStats);

// 验证数据一致性
let passed = true;
for (const initial of initialStats) {
  const cached = cacheStats.find(c => c.storage_id === initial.storage_instance_id);
  if (!cached) {
    console.log(`   ✗ 缺少存储实例 ${initial.storage_instance_id} 的缓存`);
    passed = false;
  } else if (cached.used_bytes !== Number(initial.used_bytes)) {
    console.log(`   ✗ ${initial.storage_instance_id} 容量不一致: 期望 ${initial.used_bytes}, 实际 ${cached.used_bytes}`);
    passed = false;
  } else if (cached.file_count !== Number(initial.file_count)) {
    console.log(`   ✗ ${initial.storage_instance_id} 文件数不一致: 期望 ${initial.file_count}, 实际 ${cached.file_count}`);
    passed = false;
  }
}

if (passed) {
  console.log('   ✓ 初始化数据一致性验证通过');
}

// 测试 INSERT 触发器
console.log('\n5. 测试 INSERT 触发器...');
insertFile.run('file5', 'test5.jpg', 'test5.jpg', 1536000, 's3');
const afterInsert = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
const expectedBytes = 1024000 + 2048000 + 1536000;
const expectedCount = 3; // 初始2个 + 新增1个 = 3个

if (afterInsert.used_bytes === expectedBytes && afterInsert.file_count === expectedCount) {
  console.log(`   ✓ INSERT 触发器正确: used_bytes=${afterInsert.used_bytes}, file_count=${afterInsert.file_count}`);
} else {
  console.log(`   ✗ INSERT 触发器错误: 期望 ${expectedBytes}/${expectedCount}, 实际 ${afterInsert.used_bytes}/${afterInsert.file_count}`);
  passed = false;
}

// 测试 DELETE 触发器
console.log('\n6. 测试 DELETE 触发器...');
db.prepare('DELETE FROM files WHERE id = ?').run('file1');
const afterDelete = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
const expectedBytesAfterDelete = 2048000 + 1536000; // file2 + file5
const expectedCountAfterDelete = 2; // 删除file1后剩余2个

if (afterDelete.used_bytes === expectedBytesAfterDelete && afterDelete.file_count === expectedCountAfterDelete) {
  console.log(`   ✓ DELETE 触发器正确: used_bytes=${afterDelete.used_bytes}, file_count=${afterDelete.file_count}`);
} else {
  console.log(`   ✗ DELETE 触发器错误: 期望 ${expectedBytesAfterDelete}/${expectedCountAfterDelete}, 实际 ${afterDelete.used_bytes}/${afterDelete.file_count}`);
  passed = false;
}

// 测试 UPDATE 触发器（修改大小）
console.log('\n7. 测试 UPDATE 触发器（修改大小）...');
db.prepare('UPDATE files SET size = ? WHERE id = ?').run(3000000, 'file2');
const afterUpdateSize = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
const expectedBytesAfterUpdate = 3000000 + 1536000;

if (afterUpdateSize.used_bytes === expectedBytesAfterUpdate) {
  console.log(`   ✓ UPDATE 大小触发器正确: used_bytes=${afterUpdateSize.used_bytes}`);
} else {
  console.log(`   ✗ UPDATE 大小触发器错误: 期望 ${expectedBytesAfterUpdate}, 实际 ${afterUpdateSize.used_bytes}`);
  passed = false;
}

// 测试 UPDATE 触发器（迁移存储实例）
console.log('\n8. 测试 UPDATE 触发器（迁移存储实例）...');
db.prepare('UPDATE files SET storage_instance_id = ? WHERE id = ?').run('local-1', 'file5');
const s3AfterMigrate = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
const localAfterMigrate = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('local-1');

const expectedS3Bytes = 3000000; // 只剩file2（已更新为3000000）
const expectedS3Count = 1; // 只剩1个文件
const expectedLocalBytes = 512000 + 768000 + 1536000; // file3 + file4 + file5
const expectedLocalCount = 3; // 3个文件

if (s3AfterMigrate.used_bytes === expectedS3Bytes && s3AfterMigrate.file_count === expectedS3Count) {
  console.log(`   ✓ 源存储实例减少正确: s3 used_bytes=${s3AfterMigrate.used_bytes}, file_count=${s3AfterMigrate.file_count}`);
} else {
  console.log(`   ✗ 源存储实例减少错误: 期望 ${expectedS3Bytes}/${expectedS3Count}, 实际 ${s3AfterMigrate.used_bytes}/${s3AfterMigrate.file_count}`);
  passed = false;
}

if (localAfterMigrate.used_bytes === expectedLocalBytes && localAfterMigrate.file_count === expectedLocalCount) {
  console.log(`   ✓ 目标存储实例增加正确: local-1 used_bytes=${localAfterMigrate.used_bytes}, file_count=${localAfterMigrate.file_count}`);
} else {
  console.log(`   ✗ 目标存储实例增加错误: 期望 ${expectedLocalBytes}/${expectedLocalCount}, 实际 ${localAfterMigrate.used_bytes}/${localAfterMigrate.file_count}`);
  passed = false;
}

// 测试回滚
console.log('\n9. 测试回滚脚本...');
const rollbackSql = fs.readFileSync(
  path.join(__dirname, '../database/migrations/001_rollback_storage_quota_cache.sql'),
  'utf8'
);
db.exec(rollbackSql);

const tableExists = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name='storage_quota_cache'
`).get();

if (!tableExists) {
  console.log('   ✓ 回滚成功，缓存表已删除');
} else {
  console.log('   ✗ 回滚失败，缓存表仍存在');
  passed = false;
}

// 清理
db.close();
fs.unlinkSync(testDbPath);

console.log('\n=== 测试结果 ===');
if (passed) {
  console.log('✓ 所有测试通过');
  process.exit(0);
} else {
  console.log('✗ 部分测试失败');
  process.exit(1);
}
