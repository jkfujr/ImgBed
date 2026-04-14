import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function createEmptyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function listTableNames(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name ASC
  `).all().map((row) => row.name);
}

function listTriggerNames(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger'
    ORDER BY name ASC
  `).all().map((row) => row.name);
}

export {
  createEmptyDb,
  listTableNames,
  listTriggerNames,
};
