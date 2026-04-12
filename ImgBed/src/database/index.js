import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

import { getLastKnownGoodConfig } from '../config/index.js';
import { resolveAppPath } from '../config/app-root.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('database');
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const config = getLastKnownGoodConfig();
const dbPath = resolveAppPath(config.database.path || './data/database.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);

sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA synchronous = NORMAL');
sqlite.exec('PRAGMA cache_size = -64000');
sqlite.exec('PRAGMA temp_store = MEMORY');
sqlite.exec('PRAGMA mmap_size = 268435456');
sqlite.exec('PRAGMA foreign_keys = ON');

log.info({ dbPath }, '数据库连接已建立');

const run = (sql, params = []) => sqlite.prepare(sql).run(params);
const get = (sql, params = []) => sqlite.prepare(sql).get(params);
const all = (sql, params = []) => sqlite.prepare(sql).all(params);
const transaction = (fn) => sqlite.transaction(fn);

export { sqlite, run, get, all, transaction, dbPath };
