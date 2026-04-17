import { DEFAULT_PAGE_SIZE } from '../utils/constants.js';

export function normalizeFilesPageSize(value, fallback = DEFAULT_PAGE_SIZE) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function buildFilesPageCacheKey(directory, pageSize, page) {
  return `${directory}::size:${pageSize}::page:${page}`;
}

export function createFilesListState({
  pageData = [],
  masonryData = [],
  directories = [],
  total = 0,
  currentPage = 1,
  loadedPageCount = 0,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

  return {
    pageData,
    masonryData,
    directories,
    total,
    totalPages,
    currentPage,
    loadedPageCount,
    hasMore: loadedPageCount < totalPages,
  };
}

export function flattenFilesPages(pageMap, directory, pageSize, loadedPageCount) {
  const result = [];

  for (let page = 1; page <= loadedPageCount; page += 1) {
    const pageData = pageMap.get(buildFilesPageCacheKey(directory, pageSize, page));
    if (!pageData) {
      break;
    }
    result.push(...pageData.data);
  }

  return result;
}
