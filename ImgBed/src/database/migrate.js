import fs from 'fs';

import { createLogger } from '../utils/logger.js';
import { migrateV001 } from './migrations/v001.js';
import { migrateV002 } from './migrations/v002.js';
import { migrateV003 } from './migrations/v003.js';
import { migrateV004 } from './migrations/v004.js';

const log = createLogger('database:migrate');

const MIGRATION_STEPS = [
  { version: 1, migrate: migrateV001 },
  { version: 2, migrate: migrateV002 },
  { version: 3, migrate: migrateV003 },
  { version: 4, migrate: migrateV004 },
];

const CURRENT_VERSION = MIGRATION_STEPS[MIGRATION_STEPS.length - 1].version;

export function runMigrations(db, dbPath) {
  try {
    const tableExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get();
    const isNewDb = !tableExists;

    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    if (isNewDb) {
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(CURRENT_VERSION);
      log.info({ version: CURRENT_VERSION }, '新数据库已直接初始化到最新结构，跳过迁移');
      return;
    }

    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    const currentVersion = row?.v ?? 0;

    if (currentVersion >= CURRENT_VERSION) {
      log.info({ version: currentVersion }, '数据库已是最新版本，跳过迁移');
      return;
    }

    if (dbPath && fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = `${dbPath}.backup-v${currentVersion}-${ts}`;
      fs.copyFileSync(dbPath, backupPath);
      log.info({ backupPath }, '迁移前已创建数据库备份');
    }

    log.info({ from: currentVersion, to: CURRENT_VERSION }, '开始执行数据库迁移');

    for (const step of MIGRATION_STEPS) {
      if (currentVersion < step.version) {
        step.migrate(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(step.version);
        log.info({ version: step.version }, '迁移步骤完成');
      }
    }

    log.info({ version: CURRENT_VERSION }, '数据库迁移完成');
  } catch (err) {
    log.error({ err }, '数据库迁移失败');
    throw err;
  }
}
