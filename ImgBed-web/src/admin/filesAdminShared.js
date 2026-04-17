import { FileDocs, DirectoryDocs } from '../api.js';
import { DEFAULT_PAGE_SIZE } from '../utils/constants.js';
import { createFilesListState } from './filesAdminPagination.js';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const ROOT_DIR = '/';
export const EMPTY_LIST = createFilesListState();
export const EMPTY_DELETE = { open: false, ids: [], label: '', saving: false, deleteMode: 'remote_and_index', errorMessage: '' };

/**
 * 判断文件是否存储在 Telegram 且上传时间超过 24 小时
 * @param {Object} item - 文件记录，含 storage_channel 和 created_at
 * @returns {boolean}
 */
export function isTelegramFileOlderThan24h(item) {
  if (!item || item.storage_channel !== 'telegram') return false;
  if (!item.created_at) return false;
  const uploadTime = new Date(item.created_at).getTime();
  const now = Date.now();
  return (now - uploadTime) > 24 * 60 * 60 * 1000;
}

/**
 * 判断是否所有待删文件均为 TG 且均超过 24 小时
 * @param {Object[]} items - 文件记录数组
 * @returns {boolean}
 */
export function areAllTelegramFilesOlderThan24h(items) {
  if (!items || items.length === 0) return false;
  return items.every((item) => isTelegramFileOlderThan24h(item));
}

/**
 * 判断是否存在 TG 超过 24 小时的文件（部分或全部）
 * @param {Object[]} items - 文件记录数组
 * @returns {boolean}
 */
export function hasTelegramFilesOlderThan24h(items) {
  if (!items || items.length === 0) return false;
  return items.some((item) => isTelegramFileOlderThan24h(item));
}

export function normalizeDirectoryPath(path) {
  const raw = `${path ?? ''}`.trim();
  if (!raw || raw === ROOT_DIR) return ROOT_DIR;

  const withLeadingSlash = raw.startsWith(ROOT_DIR) ? raw : `${ROOT_DIR}${raw}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, ROOT_DIR);
  const trimmed = collapsed.replace(/\/+$/g, '');

  return trimmed || ROOT_DIR;
}

export function getDirectoryPathFromSearch(search) {
  const params = new URLSearchParams(search);
  return normalizeDirectoryPath(params.get('path'));
}

export function buildFilesAdminPath(dir) {
  const normalized = normalizeDirectoryPath(dir);
  return `/admin/files?path=${encodeURIComponent(normalized)}`;
}

export function getCacheKey(dir) {
  return normalizeDirectoryPath(dir);
}

export function buildDirectoryChildren(allDirs, dir) {
  const parentPath = normalizeDirectoryPath(dir);
  const prefix = parentPath === ROOT_DIR ? ROOT_DIR : `${parentPath}/`;

  return allDirs
    .filter((entry) => {
      if (entry.path === parentPath || !entry.path.startsWith(prefix)) return false;
      const suffix = entry.path.slice(prefix.length);
      return suffix.length > 0 && !suffix.includes('/');
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseListResponse(pageRes, { page = 1, pageSize = PAGE_SIZE } = {}) {
  const list = pageRes.code === 0 && pageRes.data ? (pageRes.data.list || []) : [];
  const total = pageRes.code === 0 && pageRes.data ? (pageRes.data.pagination?.total || 0) : 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    data: list,
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  };
}

export function updateCachedDirectories(cache, allDirs) {
  for (const [key, value] of cache.entries()) {
    cache.set(key, {
      ...value,
      directories: buildDirectoryChildren(allDirs, key),
    });
  }
}

export async function fetchDirectories(currentDir) {
  const normalizedDir = normalizeDirectoryPath(currentDir);
  const dirsRes = await DirectoryDocs.list({ type: 'flat' });
  if (dirsRes.code !== 0 || !dirsRes.data) return { allDirs: null, directories: [] };

  const allDirs = dirsRes.data.list || dirsRes.data || [];
  return {
    allDirs,
    directories: buildDirectoryChildren(allDirs, normalizedDir),
  };
}

export async function fetchListPage(dir, { page = 1, pageSize = PAGE_SIZE } = {}) {
  const normalizedDir = normalizeDirectoryPath(dir);
  const params = { page, pageSize, directory: normalizedDir };
  const pageRes = await FileDocs.list(params);
  return parseListResponse(pageRes, { page, pageSize });
}

export async function loadFilesAdminPageData({
  currentDir,
  page = 1,
  pageSize = PAGE_SIZE,
  keepDirectories = false,
  cachedDirectories = null,
  fetchDirectoriesImpl = fetchDirectories,
  fetchListPageImpl = fetchListPage,
  loggerImpl = console,
}) {
  const directoryPromise = keepDirectories && Array.isArray(cachedDirectories)
    ? Promise.resolve({
      allDirs: cachedDirectories,
      directories: buildDirectoryChildren(cachedDirectories, currentDir),
    })
    : Promise.resolve(fetchDirectoriesImpl(currentDir)).catch((error) => {
      loggerImpl?.warn?.('目录加载失败，继续加载文件列表', error);
      return {
        allDirs: null,
        directories: [],
      };
    });

  const [directoryResult, pageResult] = await Promise.all([
    directoryPromise,
    fetchListPageImpl(currentDir, { page, pageSize }),
  ]);

  return {
    nextPage: pageResult,
    directories: directoryResult.directories,
    allDirs: directoryResult.allDirs,
  };
}
