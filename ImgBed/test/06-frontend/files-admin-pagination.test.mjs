import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFilesPageCacheKey,
  createFilesListState,
  flattenFilesPages,
  normalizeFilesPageSize,
} from '../../../ImgBed-web/src/admin/filesAdminPagination.js';

test('normalizeFilesPageSize 会把非法输入回退到默认值', () => {
  assert.equal(normalizeFilesPageSize('40'), 40);
  assert.equal(normalizeFilesPageSize('0'), 20);
  assert.equal(normalizeFilesPageSize('-1'), 20);
  assert.equal(normalizeFilesPageSize('abc'), 20);
  assert.equal(normalizeFilesPageSize(undefined), 20);
});

test('buildFilesPageCacheKey 会按目录、页大小和页码生成稳定键', () => {
  assert.equal(
    buildFilesPageCacheKey('/demo', 40, 3),
    '/demo::size:40::page:3',
  );
});

test('createFilesListState 会基于总数和页大小推导总页数与 hasMore', () => {
  const state = createFilesListState({
    pageData: [{ id: 'file-1' }],
    masonryData: [{ id: 'file-1' }, { id: 'file-2' }],
    directories: [{ path: '/demo', name: 'demo' }],
    total: 45,
    currentPage: 2,
    loadedPageCount: 2,
    pageSize: 20,
  });

  assert.deepEqual(state, {
    pageData: [{ id: 'file-1' }],
    masonryData: [{ id: 'file-1' }, { id: 'file-2' }],
    directories: [{ path: '/demo', name: 'demo' }],
    total: 45,
    totalPages: 3,
    currentPage: 2,
    loadedPageCount: 2,
    hasMore: true,
  });
});

test('flattenFilesPages 会按顺序合并当前目录已缓存页', () => {
  const pageMap = new Map([
    [
      buildFilesPageCacheKey('/demo', 20, 1),
      { data: [{ id: 'file-1' }, { id: 'file-2' }] },
    ],
    [
      buildFilesPageCacheKey('/demo', 20, 2),
      { data: [{ id: 'file-3' }] },
    ],
    [
      buildFilesPageCacheKey('/other', 20, 1),
      { data: [{ id: 'other-1' }] },
    ],
  ]);

  assert.deepEqual(
    flattenFilesPages(pageMap, '/demo', 20, 2),
    [{ id: 'file-1' }, { id: 'file-2' }, { id: 'file-3' }],
  );
});
