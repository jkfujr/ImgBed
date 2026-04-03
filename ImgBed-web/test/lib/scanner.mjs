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

/** 解析项目前端源码根目录 */
export function resolveProjectRoot() {
  const envRoot = process.env.IMGBED_SRC_ROOT;
  if (envRoot) return envRoot;

  for (const parts of PROJECT_ROOT_CANDIDATES) {
    const candidate = path.resolve(process.cwd(), ...parts);
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.resolve(process.cwd(), ...PROJECT_ROOT_CANDIDATES[0]);
}

// 文件内容缓存，避免多条规则重复读取同一文件
const fileCache = new Map();

/**
 * 递归扫描目录
 * @param {string} rootDir 扫描根目录
 * @param {object} options 选项
 * @param {string[]} options.extensions 文件扩展名过滤（默认 ['.js', '.jsx']）
 * @param {string[]} options.exclude 排除的目录名（默认 ['node_modules', 'dist', '.git']）
 * @returns {{ filePath: string, relativePath: string, content: string, lines: string[] }[]}
 */
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
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
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
    }
  }

  walk(rootDir);
  return results;
}

/** 清除文件缓存 */
export function clearCache() {
  fileCache.clear();
}
