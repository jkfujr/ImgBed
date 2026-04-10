/**
 * api_tokens 表 DDL：CREATE TABLE + 4 个索引（含 UNIQUE）+ updated_at 触发器。
 * @param {import('better-sqlite3').Database} db
 */
export function createApiTokensSchema(db) {
  db.exec(`
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

    CREATE TRIGGER IF NOT EXISTS update_api_tokens_updated_at
      AFTER UPDATE ON api_tokens
      BEGIN
        UPDATE api_tokens SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `);
}
