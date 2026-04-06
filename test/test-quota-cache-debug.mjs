import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('../ImgBed/node_modules/better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test-quota-cache-debug.sqlite');

// 清理旧测试数据库
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const db = new Database(testDbPath);
db.exec('PRAGMA journal_mode = WAL');

console.log('=== 调试触发器 ===\n');

// 创建基础表结构
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

// 执行迁移
const migrationSql = fs.readFileSync(
  path.join(__dirname, '../ImgBed/database/migrations/001_add_storage_quota_cache.sql'),
  'utf8'
);
db.exec(migrationSql);

// 插入第一条记录
console.log('1. 插入第一条 s3 记录...');
db.prepare('INSERT INTO files (id, file_name, original_name, size, storage_instance_id) VALUES (?, ?, ?, ?, ?)').run('file1', 'test1.jpg', 'test1.jpg', 1000, 's3');
let cache = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
console.log('   缓存:', cache);

// 插入第二条记录
console.log('\n2. 插入第二条 s3 记录...');
db.prepare('INSERT INTO files (id, file_name, original_name, size, storage_instance_id) VALUES (?, ?, ?, ?, ?)').run('file2', 'test2.jpg', 'test2.jpg', 2000, 's3');
cache = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
console.log('   缓存:', cache);
console.log('   期望: used_bytes=3000, file_count=2');

// 删除第一条记录
console.log('\n3. 删除第一条记录...');
db.prepare('DELETE FROM files WHERE id = ?').run('file1');
cache = db.prepare('SELECT * FROM storage_quota_cache WHERE storage_id = ?').get('s3');
console.log('   缓存:', cache);
console.log('   期望: used_bytes=2000, file_count=1');

// 清理
db.close();
fs.unlinkSync(testDbPath);
