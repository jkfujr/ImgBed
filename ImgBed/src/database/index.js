import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createLogger } from '../utils/logger.js';

const log = createLogger('database');

// better-sqlite3 以 CommonJS 形式发布，需要 createRequire 在 ESM 中加载
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// 确保数据目录存在
const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../', config.database.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// better-sqlite3 默认开启 WAL 支持
const sqlite = new Database(dbPath);

// SQLITE PRAGMA 配置
sqlite.exec('PRAGMA journal_mode = WAL');       // 写操作不阻塞读操作
sqlite.exec('PRAGMA synchronous = NORMAL');     // 平衡性能与安全性
sqlite.exec('PRAGMA cache_size = -64000');      // 64MB 缓存
sqlite.exec('PRAGMA temp_store = MEMORY');      // 临时表存内存
sqlite.exec('PRAGMA mmap_size = 268435456');    // 256MB 内存映射 I/O
sqlite.exec('PRAGMA foreign_keys = ON');        // 启用外键约束（级联删除等生效）

log.info({ dbPath }, '数据库连接已建立');

// 便捷封装：保持与常见调用一致性
const run = (sql, params = []) => sqlite.prepare(sql).run(params);
const get = (sql, params = []) => sqlite.prepare(sql).get(params);
const all = (sql, params = []) => sqlite.prepare(sql).all(params);
const transaction = (fn) => sqlite.transaction(fn);

export { sqlite, run, get, all, transaction, dbPath };
