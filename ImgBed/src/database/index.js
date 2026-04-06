import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// better-sqlite3 以 CommonJS 形式发布，需要 createRequire 在 ESM 中加载
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// 确保数据目录存在
const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../', config.database.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// better-sqlite3 默认开启 WAL 支持；这里仍按原配置显式设置
const sqlite = new Database(dbPath);

// 启用 WAL 模式以提升并发读写性能
sqlite.exec('PRAGMA journal_mode = WAL');       // 写操作不阻塞读操作
sqlite.exec('PRAGMA synchronous = NORMAL');     // 平衡性能与安全性
sqlite.exec('PRAGMA cache_size = -64000');      // 64MB 缓存
sqlite.exec('PRAGMA temp_store = MEMORY');      // 临时表存内存
sqlite.exec('PRAGMA mmap_size = 268435456');    // 256MB 内存映射 I/O

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
                 uploader_type TEXT,
                 uploader_id TEXT,
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

                 -- 冗余存储实例 ID（用于容量统计优化）
                 storage_instance_id TEXT,

                 is_chunked BOOLEAN DEFAULT FALSE,
                 chunk_count INTEGER DEFAULT 0
             );

            CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory);
            CREATE INDEX IF NOT EXISTS idx_files_storage_channel ON files(storage_channel);
            CREATE INDEX IF NOT EXISTS idx_files_storage_instance ON files(storage_instance_id);
            CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);
            CREATE INDEX IF NOT EXISTS idx_files_is_chunked ON files(is_chunked);

            -- 复合索引优化查询性能
            CREATE INDEX IF NOT EXISTS idx_files_dir_time ON files(directory, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_channel_time ON files(storage_channel, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_uploader ON files(uploader_type, uploader_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_name_search ON files(file_name COLLATE NOCASE);

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

            -- 存储容量事件账本表（唯一增量事实来源）
            CREATE TABLE IF NOT EXISTS storage_quota_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_id TEXT NOT NULL,
                file_id TEXT,
                storage_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                bytes_delta INTEGER NOT NULL,
                file_count_delta INTEGER NOT NULL DEFAULT 0,
                idempotency_key TEXT NOT NULL UNIQUE,
                payload JSON,
                applied_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_quota_events_operation_id ON storage_quota_events(operation_id);
            CREATE INDEX IF NOT EXISTS idx_quota_events_storage_id ON storage_quota_events(storage_id);
            CREATE INDEX IF NOT EXISTS idx_quota_events_applied_at ON storage_quota_events(applied_at);
            CREATE INDEX IF NOT EXISTS idx_quota_events_created_at ON storage_quota_events(created_at DESC);

            -- 存储操作状态表（跨远程副作用/本地事务的补偿跟踪）
            CREATE TABLE IF NOT EXISTS storage_operations (
                id TEXT PRIMARY KEY,
                operation_type TEXT NOT NULL,
                file_id TEXT,
                status TEXT NOT NULL,
                source_storage_id TEXT,
                target_storage_id TEXT,
                remote_payload JSON,
                compensation_payload JSON,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_storage_operations_status ON storage_operations(status);
            CREATE INDEX IF NOT EXISTS idx_storage_operations_file_id ON storage_operations(file_id);
            CREATE INDEX IF NOT EXISTS idx_storage_operations_created_at ON storage_operations(created_at DESC);

            CREATE TRIGGER IF NOT EXISTS update_storage_operations_updated_at
                AFTER UPDATE ON storage_operations
                BEGIN
                    UPDATE storage_operations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
                END;

            -- 存储容量校正记录历史表（快照/观测层）
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

        // 当前初始化直接以完整 schema 建表，不执行迁移；版本保持 v0
        sqlite.exec('PRAGMA user_version = 0');

        console.log('[数据库] 表结构初始化完成。');
    } catch (err) {
        console.error('[数据库] 初始化失败:', err);
        throw err; // 如果初始化失败则阻断启动
    }
};

// 便捷封装：保持与常见调用一致性
const run = (sql, params = []) => sqlite.prepare(sql).run(params);
const get = (sql, params = []) => sqlite.prepare(sql).get(params);
const all = (sql, params = []) => sqlite.prepare(sql).all(params);
const transaction = (fn) => sqlite.transaction(fn);

export { sqlite, initDb, run, get, all, transaction };
