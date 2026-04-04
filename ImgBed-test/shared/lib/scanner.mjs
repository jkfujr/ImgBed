/**
 * 文件扫描器模块
 * 递归遍历源码目录，返回文件信息列表（含内容缓存）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SCAN_EXTENSIONS,
  DEFAULT_SCAN_EXCLUDE_DIRS,
  PROJECT_ROOT_CANDIDATES,
} from '../config/scan-config.mjs';

export function resolveProjectRoot(options = {}) {
  const {
    envVar = 'IMGBED_SRC_ROOT',
    candidates = PROJECT_ROOT_CANDIDATES,
    fallbackParts = PROJECT_ROOT_CANDIDATES[0] || ['src'],
  } = options;

  const envRoot = process.env[envVar];
  if (envRoot) return envRoot;

  for (const parts of candidates) {
    const candidate = path.resolve(process.cwd(), ...parts);
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.resolve(process.cwd(), ...fallbackParts);
}

const fileCache = new Map();

export function scanFiles(rootDir, options = {}) {
  const {
    extensions = DEFAULT_SCAN_EXTENSIONS,
    exclude = DEFAULT_SCAN_EXCLUDE_DIRS,
  } = options;

  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!exclude.includes(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!extensions.includes(ext)) continue;

      let content;
      if (fileCache.has(fullPath)) {
        content = fileCache.get(fullPath);
      } else {
        try {
          content = fs.readFileSync(fullPath, 'utf8');
          fileCache.set(fullPath, content);
        } catch {
          continue;
        }
      }

      results.push({
        filePath: fullPath,
        relativePath: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
        content,
        lines: content.split('\n'),
      });
    }
  }

  walk(rootDir);
  return results;
}

export function clearCache() {
  fileCache.clear();
}
