import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ImgBed/package.json'));
const Database = require('better-sqlite3');

const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ImgBed/data/database.sqlite');
const db = new Database(dbPath);

try {
  // 检查 is_admin 列
  const tableInfo = db.prepare("PRAGMA table_info(access_logs)").all();
  console.log('access_logs 表结构:');
  tableInfo.forEach(col => {
    console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
  });

  // 统计访问记录
  const total = db.prepare('SELECT COUNT(*) as count FROM access_logs').get();
  const adminAccess = db.prepare('SELECT COUNT(*) as count FROM access_logs WHERE is_admin = 1').get();
  const userAccess = db.prepare('SELECT COUNT(*) as count FROM access_logs WHERE is_admin = 0 OR is_admin IS NULL').get();

  console.log('\n访问统计:');
  console.log(`  总访问: ${total.count}`);
  console.log(`  管理员访问: ${adminAccess.count}`);
  console.log(`  用户访问: ${userAccess.count}`);
} catch (error) {
  console.error('✗ 验证失败:', error.message);
  process.exit(1);
} finally {
  db.close();
}
