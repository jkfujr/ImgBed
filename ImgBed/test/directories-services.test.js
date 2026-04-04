const assert = require('node:assert/strict');
const { resolveParentPath, checkPathConflict, buildPath, updateChildrenPaths, renameDirectory } = require('../src/services/directories/directory-operations');

function createDbRecorder(directories = []) {
  const updatedRows = [];
  const insertedRows = [];

  return {
    updatedRows,
    insertedRows,
    api: {
      selectFrom(table) {
        assert.equal(table, 'directories' || table === 'files');
        const state = { rows: directories, table };
        return {
          selectAll() {
            return this;
          },
          select(columns) {
            state.columns = columns;
            return this;
          },
          where(column, operator, value) {
            state.whereClause = { column, operator, value };
            return this;
          },
          async executeTakeFirst() {
            if (state.whereClause) {
              const { column, operator, value } = state.whereClause;
              if (operator === '=') {
                return state.rows.find(r => r[column] === value);
              }
              if (operator === 'like') {
                const pattern = value.replace('%', '');
                return state.rows.find(r => r[column] && r[column].includes(pattern));
              }
            }
            return state.rows[0];
          },
          async execute() {
            if (state.whereClause) {
              const { column, operator, value } = state.whereClause;
              if (operator === 'like') {
                const pattern = value.replace(/%/g, '');
                return state.rows.filter(r => r[column] && r[column].includes(pattern));
              }
            }
            return state.rows;
          },
        };
      },
      updateTable(table) {
        return {
          set(payload) {
            return {
              where(column, operator, value) {
                return {
                  async execute() {
                    updatedRows.push({ table, column, operator, value, payload });
                  },
                };
              },
            };
          },
        };
      },
      insertInto(table) {
        return {
          values(payload) {
            return {
              returningAll() {
                return {
                  async executeTakeFirst() {
                    insertedRows.push(payload);
                    return { id: 1, ...payload };
                  },
                };
              },
            };
          },
        };
      },
      fn: {
        count(column) {
          return { as: (alias) => alias };
        },
      },
    },
  };
}

async function testResolveParentPathWithoutParent() {
  const db = createDbRecorder();
  const result = await resolveParentPath(null, db.api);
  assert.deepEqual(result, { parentPath: '/', parentIdToSave: null });
}

async function testResolveParentPathWithParent() {
  const db = createDbRecorder([{ id: 1, path: '/parent', name: 'parent' }]);
  const result = await resolveParentPath(1, db.api);
  assert.deepEqual(result, { parentPath: '/parent', parentIdToSave: 1 });
}

async function testResolveParentPathThrowsWhenMissing() {
  const db = createDbRecorder([]);
  try {
    await resolveParentPath(999, db.api);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 404);
    assert.ok(err.message.includes('父级目录不存在'));
  }
}

async function testCheckPathConflictThrowsWhenExists() {
  const db = createDbRecorder([{ id: 1, path: '/test', name: 'test' }]);
  try {
    await checkPathConflict('/test', db.api);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 409);
    assert.ok(err.message.includes('同名目录已存在'));
  }
}

async function testCheckPathConflictPassesWhenNotExists() {
  const db = createDbRecorder([]);
  await checkPathConflict('/new', db.api);
}

async function testBuildPathWithRootParent() {
  assert.equal(buildPath('/', 'test'), '/test');
  assert.equal(buildPath(null, 'test'), '/test');
}

async function testBuildPathWithNestedParent() {
  assert.equal(buildPath('/parent', 'child'), '/parent/child');
}

async function testBuildPathSanitizesSlashes() {
  assert.equal(buildPath('/parent', 'child/bad'), '/parent/childbad');
  assert.equal(buildPath('/parent', 'child\\bad'), '/parent/childbad');
}

async function testUpdateChildrenPaths() {
  const db = createDbRecorder([
    { id: 2, path: '/old/child1' },
    { id: 3, path: '/old/child2' },
  ]);

  await updateChildrenPaths('/old', '/new', db.api);

  assert.equal(db.updatedRows.length, 4);
  assert.equal(db.updatedRows[0].table, 'directories');
  assert.equal(db.updatedRows[0].payload.path, '/new/child1');
  assert.equal(db.updatedRows[1].table, 'files');
  assert.equal(db.updatedRows[1].payload.directory, '/new/child1');
}

async function testRenameDirectoryUpdatesPathAndFiles() {
  const db = createDbRecorder([
    { id: 1, path: '/old', name: 'old', parent_id: null },
  ]);

  const result = await renameDirectory(1, 'new', db.api);

  assert.deepEqual(result, { id: 1, name: 'new', path: '/new' });
  assert.equal(db.updatedRows.length, 2);
  assert.equal(db.updatedRows[0].table, 'directories');
  assert.equal(db.updatedRows[0].payload.name, 'new');
  assert.equal(db.updatedRows[0].payload.path, '/new');
  assert.equal(db.updatedRows[1].table, 'files');
  assert.equal(db.updatedRows[1].payload.directory, '/new');
}

async function testRenameDirectoryThrowsWhenNotFound() {
  const db = createDbRecorder([]);
  try {
    await renameDirectory(999, 'new', db.api);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 404);
    assert.ok(err.message.includes('修改对象不存在'));
  }
}

async function main() {
  await testResolveParentPathWithoutParent();
  await testResolveParentPathWithParent();
  await testResolveParentPathThrowsWhenMissing();
  await testCheckPathConflictThrowsWhenExists();
  await testCheckPathConflictPassesWhenNotExists();
  await testBuildPathWithRootParent();
  await testBuildPathWithNestedParent();
  await testBuildPathSanitizesSlashes();
  await testUpdateChildrenPaths();
  await testRenameDirectoryUpdatesPathAndFiles();
  await testRenameDirectoryThrowsWhenNotFound();
  console.log('directories services tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
