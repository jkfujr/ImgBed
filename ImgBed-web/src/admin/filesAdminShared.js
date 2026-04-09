import { FileDocs, DirectoryDocs } from '../api';
import { DEFAULT_PAGE_SIZE } from '../utils/constants';

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const ROOT_DIR = '/';
export const EMPTY_LIST = { data: [], total: 0, hasMore: false, directories: [] };
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

export function getCacheKey(dir) {
  return dir;
}

export function buildDirectoryChildren(allDirs, dir) {
  const parentPath = dir;
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
    cache.set(key, {
      ...value,
      directories: buildDirectoryChildren(allDirs, key),
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
  const params = { page: 1, pageSize: PAGE_SIZE, directory: dir };
  const pageRes = await FileDocs.list(params);
  return parseListResponse(pageRes);
}
