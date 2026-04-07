import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ImgBed/package.json'));
const Database = require('better-sqlite3');

const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ImgBed/data/database.sqlite');
const db = new Database(dbPath);

try {
  // 获取一个测试文件ID
  const file = db.prepare('SELECT id, original_name, mime_type, size, updated_at FROM files LIMIT 1').get();

  if (!file) {
    console.log('数据库中没有文件，无法测试');
    process.exit(0);
  }

  console.log('测试文件信息:');
  console.log(`  ID: ${file.id}`);
  console.log(`  文件名: ${file.original_name}`);
  console.log(`  MIME: ${file.mime_type}`);
  console.log(`  大小: ${file.size} bytes`);
  console.log(`  更新时间: ${file.updated_at}`);
  console.log('\n当前缓存策略:');
  console.log('  Cache-Control: public, max-age=31536000 (1年强缓存)');
  console.log('  缺少: ETag 和 Last-Modified (协商缓存)');
  console.log('\n建议优化:');
  console.log('  1. 添加 ETag: 基于文件 ID + updated_at 生成');
  console.log('  2. 添加 Last-Modified: 使用 updated_at 字段');
  console.log('  3. 支持 If-None-Match 和 If-Modified-Since 请求头');
  console.log('  4. 304 Not Modified 响应减少带宽消耗');
} catch (error) {
  console.error('验证失败:', error.message);
  process.exit(1);
} finally {
  db.close();
}
