const Database = require('better-sqlite3');
const { Kysely, SqliteDialect } = require('kysely');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// 确保数据目录存在
const dbPath = path.resolve(__dirname, '../../', config.database.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);

const db = new Kysely({
  dialect: new SqliteDialect({
    database: sqlite,
  }),
});

// ========== 数据库版本迁移机制 ==========

const CURRENT_SCHEMA_VERSION = 2;

/**
 * 安全添加列（仅在迁移函数内部使用）
 */
const _addColumnIfNotExists = (tableName, columnName, columnSql) => {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql};`);
    console.log(`[数据库迁移] ${tableName} 表添加列: ${columnName}`);
  }
};

/**
 * 迁移函数列表（索引 = 目标版本号）
 * 每个函数负责从 version-1 升级到 version
 */
const migrations = [
  // v0 → v1: 基础表结构由 CREATE TABLE IF NOT EXISTS 创建，无额外操作
  () => {},
  // v1 → v2: files 表新增 uploader_type/uploader_id，chunks 表新增 size
  () => {
    _addColumnIfNotExists('files', 'uploader_type', 'uploader_type TEXT');
    _addColumnIfNotExists('files', 'uploader_id', 'uploader_id TEXT');
    _addColumnIfNotExists('chunks', 'size', 'size INTEGER DEFAULT 0');
  }
];

/**
 * 执行数据库迁移
 * 检测当前版本，备份旧库，逐版本升级
 */
const runMigrations = () => {
  const currentVersion = sqlite.pragma('user_version', { simple: true });

  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  // 备份旧数据库
  if (currentVersion > 0 && fs.existsSync(dbPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bakPath = `${dbPath}.v${currentVersion}.${timestamp}.bak`;
    fs.copyFileSync(dbPath, bakPath);
    console.log(`[数据库迁移] 已备份旧数据库: ${path.basename(bakPath)}`);
  }

  // 逐版本执行迁移
  for (let v = currentVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const migrateFn = migrations[v];
    if (migrateFn) {
      console.log(`[数据库迁移] 执行迁移 v${v} → v${v + 1}`);
      migrateFn();
    }
  }

  sqlite.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  console.log(`[数据库迁移] 版本升级完成: v${currentVersion} → v${CURRENT_SCHEMA_VERSION}`);
};

// 初始化数据库表
const initDb = () => {
    try {
        // files table
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT,
                size INTEGER NOT NULL,

                -- 存储渠道信息
                storage_channel TEXT NOT NULL,
                storage_key TEXT NOT NULL,
                storage_config JSON,

                -- 上传信息
                upload_ip TEXT,
                upload_address TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

                -- 分类和标签
                directory TEXT DEFAULT '/',
                tags JSON,

                -- 访问权限
                is_public BOOLEAN DEFAULT FALSE,

                -- 元数据
                width INTEGER,
                height INTEGER,
                exif JSON,

                -- 渠道特有信息
                telegram_file_id TEXT,
                telegram_chat_id TEXT,
                telegram_bot_token TEXT,

                discord_message_id TEXT,
                discord_channel_id TEXT,

                huggingface_repo TEXT,
                huggingface_path TEXT,

                is_chunked BOOLEAN DEFAULT FALSE,
                chunk_count INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory);
            CREATE INDEX IF NOT EXISTS idx_files_storage_channel ON files(storage_channel);
            CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);
            CREATE INDEX IF NOT EXISTS idx_files_is_chunked ON files(is_chunked);

            -- directories 目录表
            CREATE TABLE IF NOT EXISTS directories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                parent_id INTEGER REFERENCES directories(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- system_settings 系统设置表
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                category TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- chunks 分片表
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id TEXT NOT NULL REFERENCES files(id),
                chunk_index INTEGER NOT NULL,
                storage_type TEXT NOT NULL,
                storage_id TEXT NOT NULL,
                storage_key TEXT NOT NULL,
                storage_config JSON,
                size INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_storage_id ON chunks(storage_id);

            -- API Token 表
            CREATE TABLE IF NOT EXISTS api_tokens (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                token_prefix TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                permissions JSON NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                expires_at DATETIME,
                last_used_at DATETIME,
                last_used_ip TEXT,
                created_by TEXT NOT NULL DEFAULT 'admin',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
            CREATE INDEX IF NOT EXISTS idx_api_tokens_status ON api_tokens(status);
            CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at ON api_tokens(expires_at);
            CREATE INDEX IF NOT EXISTS idx_api_tokens_created_at ON api_tokens(created_at DESC);

            -- 触发器
            CREATE TRIGGER IF NOT EXISTS update_files_updated_at
                AFTER UPDATE ON files
                BEGIN
                    UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END;

            CREATE TRIGGER IF NOT EXISTS update_directories_updated_at
                AFTER UPDATE ON directories
                BEGIN
                    UPDATE directories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END;

            CREATE TRIGGER IF NOT EXISTS update_system_settings_updated_at
                AFTER UPDATE ON system_settings
                BEGIN
                    UPDATE system_settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
                END;

            CREATE TRIGGER IF NOT EXISTS update_chunks_updated_at
                AFTER UPDATE ON chunks
                BEGIN
                    UPDATE chunks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END;

            CREATE TRIGGER IF NOT EXISTS update_api_tokens_updated_at
                AFTER UPDATE ON api_tokens
                BEGIN
                    UPDATE api_tokens SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END;

            -- 存储渠道元数据表
            CREATE TABLE IF NOT EXISTS storage_channels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                allow_upload BOOLEAN DEFAULT TRUE,
                weight INTEGER DEFAULT 1,
                quota_limit_gb REAL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 存储容量校正记录历史表
            CREATE TABLE IF NOT EXISTS storage_quota_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                storage_id TEXT NOT NULL,
                used_bytes INTEGER NOT NULL,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_quota_history_storage_id ON storage_quota_history(storage_id);
            CREATE INDEX IF NOT EXISTS idx_quota_history_recorded_at ON storage_quota_history(recorded_at DESC);

            CREATE TRIGGER IF NOT EXISTS update_storage_channels_updated_at
                AFTER UPDATE ON storage_channels
                BEGIN
                    UPDATE storage_channels SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END;
        `);

        // 执行版本迁移（备份旧库 + 逐版本升级）
        runMigrations();

        console.log('[数据库] 表结构初始化完成。');
    } catch (err) {
        console.error('[数据库] 初始化失败:', err);
        throw err; // 如果初始化失败则阻断启动
    }
};

module.exports = {
  db,
  sqlite,
  initDb
};
