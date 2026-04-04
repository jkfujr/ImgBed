import { FileDocs, DirectoryDocs } from '../api';
import { DEFAULT_PAGE_SIZE } from '../utils/constants';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const ROOT_DIR = '/';
export const EMPTY_LIST = { data: [], total: 0, hasMore: false, directories: [] };
export const EMPTY_DELETE = { open: false, ids: [], label: '', saving: false };

export function getCacheKey(dir) {
  return dir || ROOT_DIR;
}

export function buildDirectoryChildren(allDirs, dir) {
  const parentPath = dir || ROOT_DIR;
  const prefix = parentPath === ROOT_DIR ? ROOT_DIR : `${parentPath}/`;

  return allDirs
    .filter((entry) => {
      if (entry.path === parentPath || !entry.path.startsWith(prefix)) return false;
      const suffix = entry.path.slice(prefix.length);
      return suffix.length > 0 && !suffix.includes('/');
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseListResponse(pageRes) {
  const list = pageRes.code === 0 && pageRes.data ? (pageRes.data.list || []) : [];
  const total = pageRes.code === 0 && pageRes.data ? (pageRes.data.pagination?.total || 0) : 0;
  return { data: list, total, hasMore: list.length < total };
}

export function updateCachedDirectories(cache, allDirs) {
  for (const [key, value] of cache.entries()) {
    const dir = key === ROOT_DIR ? null : key;
    cache.set(key, {
      ...value,
      directories: buildDirectoryChildren(allDirs, dir),
    });
  }
}

export async function fetchDirectories(currentDir) {
  const dirsRes = await DirectoryDocs.list({ type: 'flat' });
  if (dirsRes.code !== 0 || !dirsRes.data) return { allDirs: null, directories: [] };

  const allDirs = dirsRes.data.list || dirsRes.data || [];
  return {
    allDirs,
    directories: buildDirectoryChildren(allDirs, currentDir),
  };
}

export async function fetchListPage(dir) {
  const params = { page: 1, pageSize: PAGE_SIZE };
  if (dir) params.directory = dir;
  const pageRes = await FileDocs.list(params);
  return parseListResponse(pageRes);
}
