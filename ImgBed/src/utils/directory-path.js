import { getDirectoryByPath } from '../database/directories-dao.js';

export function normalizeDirectoryPath(input) {
  if (typeof input !== 'string') {
    throw new Error('目录路径必须是字符串');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('目录路径不能为空');
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withLeadingSlash === '/') {
    return '/';
  }

  const normalized = withLeadingSlash.replace(/\/+$/g, '');
  if (normalized === '') {
    return '/';
  }

  return normalized;
}

export function parseOptionalDirectoryPath(input) {
  if (input === undefined) {
    return undefined;
  }

  return normalizeDirectoryPath(input);
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
