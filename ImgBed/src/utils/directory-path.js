import { getDirectoryByPath } from '../database/directories-dao.js';
import { getLastKnownGoodConfig } from '../config/index.js';
import {
  DEFAULT_MAX_DIRECTORY_PATH_LENGTH,
  normalizeMaxDirectoryPathLength,
} from '../config/files-config.js';

function resolveMaxDirectoryPathLength(maxLength) {
  if (maxLength !== undefined) {
    return normalizeMaxDirectoryPathLength(maxLength);
  }

  try {
    return normalizeMaxDirectoryPathLength(getLastKnownGoodConfig().files?.maxDirectoryPathLength);
  } catch {
    return DEFAULT_MAX_DIRECTORY_PATH_LENGTH;
  }
}

function trimTrailingSlashes(path) {
  let end = path.length;
  while (end > 1 && path[end - 1] === '/') {
    end -= 1;
  }

  return path.slice(0, end);
}

export function normalizeDirectoryPath(input, { maxLength } = {}) {
  if (typeof input !== 'string') {
    throw new Error('目录路径必须是字符串');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('目录路径不能为空');
  }

  const maxDirectoryPathLength = resolveMaxDirectoryPathLength(maxLength);
  if (trimmed.length > maxDirectoryPathLength) {
    throw new Error(`目录路径长度不能超过 ${maxDirectoryPathLength} 个字符`);
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withLeadingSlash === '/') {
    return '/';
  }

  const normalized = trimTrailingSlashes(withLeadingSlash);
  if (normalized === '') {
    return '/';
  }

  return normalized;
}

export function parseOptionalDirectoryPath(input, options = {}) {
  if (input === undefined) {
    return undefined;
  }

  return normalizeDirectoryPath(input, options);
}

export function ensureExistingDirectoryPath(directory, sqlite) {
  if (directory === '/') {
    return;
  }

  const exists = getDirectoryByPath(sqlite, directory);
  if (!exists) {
    throw new Error(`目录不存在：${directory}`);
  }
}
