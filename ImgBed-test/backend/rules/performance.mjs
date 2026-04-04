/**
 * P 类规则: Performance — 后端性能风险分析
 * P01-P02
 */

const TABLE_SCAN_PATTERN = /selectFrom\(\s*['"]files['"]\s*\)[\s\S]{0,400}?\.execute\(\)/g;
const LOOP_WITH_AWAIT_PATTERN = /for\s*\([^)]*\)\s*\{[\s\S]{0,2000}?\bawait\b[\s\S]{0,2000}?\}/g;

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

const P01 = {
  code: 'P01',
  name: '全表读取后在内存中聚合',
  category: 'performance',
  severity: 'warning',
  description: '对 files 表执行全量读取后再在 Node 侧聚合统计，数据增长后会带来内存与延迟压力',
  check(file, reporter) {
    if (!file.relativePath.startsWith('src/routes/')) return;

    for (const match of file.content.matchAll(TABLE_SCAN_PATTERN)) {
      const snippet = match[0];
      const hasInMemoryAggregation = /for\s*\([^)]*\)|\.reduce\(|\.map\(|totalBytes|stats\s*=|channelsByType/.test(snippet);
      if (!hasInMemoryAggregation) continue;

      reporter.add({
        file: file.relativePath,
        line: getLineNumber(file.content, match.index),
        col: 1,
        rule: 'P01',
        severity: 'warning',
        message: '检测到对 files 表全量读取后在内存中聚合统计，建议改为数据库聚合、分页或缓存方案',
      });
    }
  },
};

const P02 = {
  code: 'P02',
  name: '批处理循环内串行异步 IO',
  category: 'performance',
  severity: 'warning',
  description: '批处理或迁移流程在循环体内串行 await 多个 IO，会放大整体耗时',
  check(file, reporter) {
    if (file.relativePath !== 'src/routes/files.js') return;

    for (const match of file.content.matchAll(LOOP_WITH_AWAIT_PATTERN)) {
      const snippet = match[0];
      const asyncIoCount = countMatches(snippet, /await\s+(storageManager\.|storage\.|db\.|ChunkManager\.|targetStorage\.|sourceStorage\.)/g);
      const looksLikeBatchFlow = /action === 'delete'|action === 'migrate'|deletedCount|results\.success|results\.failed/.test(snippet);
      if (!looksLikeBatchFlow || asyncIoCount < 2) continue;

      reporter.add({
        file: file.relativePath,
        line: getLineNumber(file.content, match.index),
        col: 1,
        rule: 'P02',
        severity: 'warning',
        message: `检测到批处理循环内串行执行 ${asyncIoCount} 次异步 IO，建议评估并发、分批或事务化方案`,
      });
    }
  },
};

export default [P01, P02];
