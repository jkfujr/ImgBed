import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

// 使用 ImgBed 目录的 node_modules
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ImgBed/package.json'));
const Database = require('better-sqlite3');

const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ImgBed/data/database.sqlite');
console.log('数据库路径:', dbPath);
const db = new Database(dbPath);

try {
  // 检查列是否已存在
  const tableInfo = db.prepare("PRAGMA table_info(access_logs)").all();
  const hasIsAdminColumn = tableInfo.some(col => col.name === 'is_admin');

  if (hasIsAdminColumn) {
    console.log('✓ is_admin 列已存在');
  } else {
    // 添加 is_admin 列
    db.exec('ALTER TABLE access_logs ADD COLUMN is_admin BOOLEAN DEFAULT 0');
    console.log('✓ 已添加 is_admin 列到 access_logs 表');
  }
} catch (error) {
  console.error('✗ 迁移失败:', error.message);
  process.exit(1);
} finally {
  db.close();
}
