/**
 * 断言工具模块
 * 从 verify-* 脚本中提取的共享断言函数
 */
import fs from 'node:fs';

/** 读取文件内容（UTF-8） */
export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/** 断言正则必须匹配，否则抛出错误 */
export function expectPresent(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Error(message);
  }
}

/** 断言正则不得匹配，否则抛出错误 */
export function expectAbsent(content, pattern, message) {
  if (pattern.test(content)) {
    throw new Error(message);
  }
}

/** 计算内容行数 */
export function countLines(content) {
  return content.split('\n').length;
}

/** 断言行数不超过上限 */
export function expectLineCountBelow(content, max, label) {
  const lines = countLines(content);
  if (lines > max) {
    throw new Error(`${label} 行数 ${lines} 超过上限 ${max}`);
  }
}

/**
 * 返回所有匹配的位置信息
 * @returns {{ match: string, line: number, col: number, index: number }[]}
 */
export function matchAllWithLines(content, pattern) {
  const results = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i];
    // 为每行创建新的正则实例
    const linePattern = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
    let m;
    while ((m = linePattern.exec(lineContent)) !== null) {
      results.push({
        match: m[0],
        line: i + 1,
        col: m.index + 1,
        index: m.index,
      });
    }
  }
  return results;
}
