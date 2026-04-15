function assertDatabase(db) {
  if (!db) {
    throw new Error('分块记录仓储缺少数据库实例');
  }
}

function insertMany(records, db) {
  assertDatabase(db);

  if (!Array.isArray(records) || records.length === 0) {
    return;
  }

  const insertChunkStmt = db.prepare(`INSERT INTO chunks (
    file_id, chunk_index, storage_type, storage_id, storage_key, storage_meta, size
  ) VALUES (
    @file_id, @chunk_index, @storage_type, @storage_id, @storage_key, @storage_meta, @size
  )`);

  for (const record of records) {
    insertChunkStmt.run(record);
  }
}

async function listByFileId(fileId, db) {
  assertDatabase(db);

  return db.prepare(
    'SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC'
  ).all(fileId);
}

function deleteByFileId(fileId, db) {
  assertDatabase(db);
  return db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
}

export {
  deleteByFileId,
  insertMany,
  listByFileId,
};
