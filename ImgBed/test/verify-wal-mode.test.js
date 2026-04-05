/**
 * 验证 SQLite WAL 模式是否成功启用
 */
const { sqlite } = require('../src/database');

function testWALMode() {
  console.log('=== SQLite WAL 模式验证 ===\n');

  // 检查 journal_mode
  const journalMode = sqlite.pragma('journal_mode', { simple: true });
  console.log(`✓ journal_mode: ${journalMode}`);
  if (journalMode !== 'wal') {
    throw new Error(`预期 journal_mode 为 'wal'，实际为 '${journalMode}'`);
  }

  // 检查 synchronous
  const synchronous = sqlite.pragma('synchronous', { simple: true });
  console.log(`✓ synchronous: ${synchronous} (1=NORMAL)`);
  if (synchronous !== 1) {
    throw new Error(`预期 synchronous 为 1 (NORMAL)，实际为 ${synchronous}`);
  }

  // 检查 cache_size
  const cacheSize = sqlite.pragma('cache_size', { simple: true });
  console.log(`✓ cache_size: ${cacheSize} (负数表示 KB)`);
  if (cacheSize !== -64000) {
    throw new Error(`预期 cache_size 为 -64000，实际为 ${cacheSize}`);
  }

  // 检查 temp_store
  const tempStore = sqlite.pragma('temp_store', { simple: true });
  console.log(`✓ temp_store: ${tempStore} (2=MEMORY)`);
  if (tempStore !== 2) {
    throw new Error(`预期 temp_store 为 2 (MEMORY)，实际为 ${tempStore}`);
  }

  // 检查 mmap_size
  const mmapSize = sqlite.pragma('mmap_size', { simple: true });
  console.log(`✓ mmap_size: ${mmapSize} bytes (${(mmapSize / 1024 / 1024).toFixed(0)} MB)`);
  if (mmapSize !== 268435456) {
    throw new Error(`预期 mmap_size 为 268435456，实际为 ${mmapSize}`);
  }

  console.log('\n✅ 所有 WAL 模式配置验证通过');
  console.log('\n预期性能提升:');
  console.log('  - 并发读写性能提升 3-5 倍');
  console.log('  - 写操作不再阻塞读操作');
  console.log('  - 缓存命中率提升，减少磁盘 I/O');
}

try {
  testWALMode();
  process.exit(0);
} catch (error) {
  console.error('\n❌ 验证失败:', error.message);
  process.exit(1);
}
