function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function hasColumn(db, tableName, columnName) {
  return getTableColumns(db, tableName).includes(columnName);
}

export {
  getTableColumns,
  hasColumn,
};
