function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function hasColumn(db, tableName, columnName) {
  return getTableColumns(db, tableName).includes(columnName);
}

function renameColumnIfNeeded(db, tableName, oldColumnName, newColumnName) {
  if (hasColumn(db, tableName, newColumnName) || !hasColumn(db, tableName, oldColumnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} RENAME COLUMN ${oldColumnName} TO ${newColumnName}`);
}

export {
  getTableColumns,
  hasColumn,
  renameColumnIfNeeded,
};
