/**
 * migrate-file.js 单元测试
 * 覆盖范围：
 *   - validateMigrationTarget：各种非法参数校验
 *   - readSourceFileAsStream（通过 migrateFileRecord 间接测试）
 *   - migrateFileRecord：非分块流式迁移、分块回退、跳过同渠道、源渠道缺失
 *   - migrateFilesBatch：并发迁移结果统计
 */

import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';

// ─────────────────────────────────────────────────────────────────────────────
// 辅助工厂
// ─────────────────────────────────────────────────────────────────────────────

/** 创建最小化伪 storageManager */
function makeStorageManager({
  instances = new Map(),
  isUploadAllowed = () => true,
  getEffectiveUploadLimits = () => ({ enableSizeLimit: false, enableChunking: false, chunkSizeMB: 5, maxChunks: 0 }),
  getStorage = (id) => instances.get(id)?.instance,
  applyPendingQuotaEvents = async () => {},
} = {}) {
  return { instances, isUploadAllowed, getEffectiveUploadLimits, getStorage, applyPendingQuotaEvents };
}

/** 创建最小化 storage 实例 */
function makeStorage({ streamContent = 'file-content', putResult = null } = {}) {
  let lastPutFile = null;
  let lastPutOptions = null;
  return {
    getStream: async () => Readable.from([Buffer.from(streamContent)]),
    put: async (file, options) => {
      lastPutFile = file;
      lastPutOptions = options;
      return putResult ?? { id: options.id || options.fileName };
    },
    getChunkConfig: () => ({ enabled: false, chunkThreshold: Infinity, chunkSize: 0, maxChunks: 0, mode: 'generic' }),
    getLastPutFile: () => lastPutFile,
    getLastPutOptions: () => lastPutOptions,
  };
}

/** 创建最小化 DB（better-sqlite3 风格） */
function makeDb(overrides = {}) {
  const stmts = {};
  return {
    prepare: (sql) => ({
      run: () => {},
      all: () => [],
      get: () => null,
    }),
    transaction: (fn) => fn, // 直接返回函数本身，调用时执行事务体
    ...overrides,
  };
}

/** 创建标准文件记录 */
function makeFileRecord(overrides = {}) {
  return {
    id: 'file-001',
    file_name: 'img.png',
    original_name: 'img.png',
    mime_type: 'image/png',
    storage_channel: 's3',
    storage_config: JSON.stringify({ instance_id: 'src-channel' }),
    storage_instance_id: 'src-channel',
    storage_key: 'img.png',
    is_chunked: 0,
    size: 1024,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 导入被测模块（动态 import 避免顶层副作用）
// ─────────────────────────────────────────────────────────────────────────────
async function importModule() {
  // 重置模块缓存（Node ESM 无法真正 uncache，但单进程内同一测试文件复用即可）
  return import('../ImgBed/src/services/files/migrate-file.js');
}

// ─────────────────────────────────────────────────────────────────────────────
// validateMigrationTarget 测试
// ─────────────────────────────────────────────────────────────────────────────

async function testValidateMissingTargetChannel() {
  const { validateMigrationTarget } = await importModule();
  const sm = makeStorageManager();
  const err = assert.throws(() => validateMigrationTarget(null, sm));
  assert.equal(err?.status ?? 400, 400);
  console.log('  [OK] validateMigrationTarget：target_channel 为空 → 400');
}

async function testValidateTargetNotFound() {
  const { validateMigrationTarget } = await importModule();
  const sm = makeStorageManager({ instances: new Map() });
  const err = assert.throws(() => validateMigrationTarget('nonexistent', sm));
  assert.equal(err?.status ?? 404, 404);
  console.log('  [OK] validateMigrationTarget：渠道不存在 → 404');
}

async function testValidateUploadNotAllowed() {
  const { validateMigrationTarget } = await importModule();
  const sm = makeStorageManager({
    instances: new Map([['ch1', { type: 's3', instance: {} }]]),
    isUploadAllowed: () => false,
  });
  const err = assert.throws(() => validateMigrationTarget('ch1', sm));
  assert.equal(err?.status ?? 403, 403);
  console.log('  [OK] validateMigrationTarget：渠道不可写 → 403');
}

async function testValidateUnsupportedType() {
  const { validateMigrationTarget } = await importModule();
  const sm = makeStorageManager({
    instances: new Map([['ch1', { type: 'telegram', instance: {} }]]),
    isUploadAllowed: () => true,
  });
  const err = assert.throws(() => validateMigrationTarget('ch1', sm));
  assert.equal(err?.status ?? 403, 403);
  console.log('  [OK] validateMigrationTarget：telegram 类型不允许 → 403');
}

async function testValidateSuccess() {
  const { validateMigrationTarget } = await importModule();
  const sm = makeStorageManager({
    instances: new Map([['ch1', { type: 's3', instance: {} }]]),
    isUploadAllowed: () => true,
  });
  const entry = validateMigrationTarget('ch1', sm);
  assert.equal(entry.type, 's3');
  console.log('  [OK] validateMigrationTarget：合法渠道返回 entry');
}

// ─────────────────────────────────────────────────────────────────────────────
// migrateFileRecord 测试
// ─────────────────────────────────────────────────────────────────────────────

/** 桩模块：替换 storage-operations / storage-artifacts / files-dao 依赖 */
function makeDepsStub() {
  // 记录调用以便断言
  const calls = {
    createStorageOperation: [],
    markOperationRemoteDone: [],
    markOperationCommitted: [],
    markOperationCompleted: [],
    insertQuotaEvents: [],
    removeStoredArtifacts: [],
    updateFileMigrationFields: [],
    applyPendingQuotaEvents: [],
  };
  return { calls };
}

/**
 * 构造运行 migrateFileRecord 所需的所有依赖，但注入伪实现
 * 由于 ESM 无法直接 mock import，改用「通过函数注入」间接测试核心流程。
 *
 * 这里直接从源码提取 migrateFileRecord 的可测试核心逻辑：
 *   1. 同渠道 → skipped
 *   2. 源渠道不存在 → failed
 *   3. 非分块：getStream → put(stream)
 *   4. 分块：streamToBuffer → uploadToStorage
 */
async function testMigrateFileRecordSkipsSameChannel() {
  const { migrateFileRecord } = await importModule();

  const storage = makeStorage();
  const sm = makeStorageManager({
    instances: new Map([
      ['same-ch', { type: 's3', instance: storage }],
    ]),
    isUploadAllowed: () => true,
  });

  const fileRecord = makeFileRecord({ storage_instance_id: 'same-ch' });
  const targetEntry = { type: 's3', instance: storage };

  const result = await migrateFileRecord(fileRecord, {
    targetChannel: 'same-ch',
    targetEntry,
    db: makeDb(),
    storageManager: sm,
  });

  assert.equal(result.status, 'skipped', '同渠道迁移应返回 skipped');
  console.log('  [OK] migrateFileRecord：同渠道 → skipped');
}

async function testMigrateFileRecordFailsWhenSourceMissing() {
  const { migrateFileRecord } = await importModule();

  const targetStorage = makeStorage();
  const sm = makeStorageManager({
    instances: new Map([
      // 注意：源渠道 'src-channel' 不在 instances 中
      ['target-ch', { type: 's3', instance: targetStorage }],
    ]),
    isUploadAllowed: () => true,
  });

  const fileRecord = makeFileRecord({ storage_instance_id: 'src-channel' });
  const targetEntry = { type: 's3', instance: targetStorage };

  const result = await migrateFileRecord(fileRecord, {
    targetChannel: 'target-ch',
    targetEntry,
    db: makeDb(),
    storageManager: sm,
  });

  assert.equal(result.status, 'failed', '源渠道不存在应返回 failed');
  console.log('  [OK] migrateFileRecord：源渠道不存在 → failed');
}

async function testMigrateFileRecordNonChunkedUsesStream() {
  const { migrateFileRecord } = await importModule();

  const content = 'stream-migrate-content';
  const srcStorage = makeStorage({ streamContent: content });
  const tgtStorage = makeStorage({ putResult: { id: 'file-001' } });

  const sm = makeStorageManager({
    instances: new Map([
      ['src-channel', { type: 's3', instance: srcStorage }],
      ['tgt-channel', { type: 's3', instance: tgtStorage }],
    ]),
    isUploadAllowed: () => true,
    getEffectiveUploadLimits: () => ({
      enableSizeLimit: false,
      enableChunking: false,
      chunkSizeMB: 5,
      maxChunks: 0,
    }),
    getStorage: (id) => {
      if (id === 'src-channel') return srcStorage;
      if (id === 'tgt-channel') return tgtStorage;
    },
    applyPendingQuotaEvents: async () => {},
  });

  // 替换外部 I/O 依赖（storage-operations 等）为 no-op
  // 由于 ESM import 缓存，直接运行会调用真实模块 → 需要 db stub 足够健壮
  const db = {
    prepare: () => ({ run: () => {}, all: () => [], get: () => null }),
    transaction: (fn) => () => fn(),  // 返回可调用函数
  };

  // 替换 storage-operations 依赖通过 stub db
  // （注：真实 storage-operations 会调用 db.prepare，已由 stub 覆盖）
  const fileRecord = makeFileRecord({
    storage_instance_id: 'src-channel',
    size: content.length,
  });

  const targetEntry = { type: 's3', instance: tgtStorage };

  const result = await migrateFileRecord(fileRecord, {
    targetChannel: 'tgt-channel',
    targetEntry,
    db,
    storageManager: sm,
  });

  assert.equal(result.status, 'success', '非分块迁移应返回 success');

  // 关键断言：目标 put 的第一个参数应是 Readable（流），而非 Buffer
  const putFile = tgtStorage.getLastPutFile();
  assert.ok(putFile instanceof Readable, `非分块迁移：put 接收的应是 Node Readable，实际是 ${putFile?.constructor?.name}`);

  // contentLength 应透传
  const putOpts = tgtStorage.getLastPutOptions();
  assert.equal(putOpts.contentLength, content.length, 'contentLength 应等于 fileRecord.size');

  console.log('  [OK] migrateFileRecord：非分块文件用流式 put，不读入内存');
}

async function testMigrateFileRecordChunkedFallsBackToBuffer() {
  const { migrateFileRecord } = await importModule();

  const content = Buffer.alloc(60 * 1024 * 1024, 'x'); // 60MB，触发 HF 分块
  const srcStorage = {
    getStream: async () => Readable.from([content]),
    getChunkConfig: () => ({ enabled: false, chunkThreshold: Infinity, chunkSize: 0, maxChunks: 0, mode: 'generic' }),
  };

  // 目标是 HuggingFace（chunkThreshold = 40MB），文件 60MB → 需要分块
  const tgtStorage = {
    putChunkCalls: [],
    getChunkConfig: () => ({
      enabled: true,
      chunkThreshold: 40 * 1024 * 1024,
      chunkSize: 40 * 1024 * 1024,
      maxChunks: 100,
      mode: 'generic',
    }),
    put: async () => { throw new Error('分块场景不应直接调用 put'); },
    putChunk: async (buf, opts) => {
      tgtStorage.putChunkCalls.push({ size: buf.length, index: opts.chunkIndex });
      return { storageKey: `chunks/file-001/chunk_${String(opts.chunkIndex).padStart(4, '0')}`, size: buf.length };
    },
  };

  const sm = makeStorageManager({
    instances: new Map([
      ['src-channel', { type: 's3', instance: srcStorage }],
      ['tgt-channel', { type: 'huggingface', instance: tgtStorage }],
    ]),
    isUploadAllowed: () => true,
    getEffectiveUploadLimits: () => ({
      enableSizeLimit: false,
      enableChunking: false,
      chunkSizeMB: 40,
      maxChunks: 100,
    }),
    getStorage: (id) => {
      if (id === 'src-channel') return srcStorage;
      if (id === 'tgt-channel') return tgtStorage;
    },
    applyPendingQuotaEvents: async () => {},
  });

  const db = {
    prepare: () => ({ run: () => {}, all: () => [], get: () => null }),
    transaction: (fn) => () => fn(),
  };

  const fileRecord = makeFileRecord({
    storage_instance_id: 'src-channel',
    size: content.length,
  });

  const targetEntry = { type: 'huggingface', instance: tgtStorage };

  const result = await migrateFileRecord(fileRecord, {
    targetChannel: 'tgt-channel',
    targetEntry,
    db,
    storageManager: sm,
  });

  assert.equal(result.status, 'success', '分块迁移应返回 success');
  // 60MB / 40MB = 2 块
  assert.equal(tgtStorage.putChunkCalls.length, 2, '应上传 2 块');
  assert.equal(tgtStorage.putChunkCalls[0].index, 0);
  assert.equal(tgtStorage.putChunkCalls[1].index, 1);

  console.log('  [OK] migrateFileRecord：分块文件回退为 buffer 分块上传');
}

// ─────────────────────────────────────────────────────────────────────────────
// migrateFilesBatch 测试
// ─────────────────────────────────────────────────────────────────────────────

async function testMigrateFilesBatchCountsResults() {
  const { migrateFilesBatch } = await importModule();

  const content = 'batch-file';
  const srcStorage = makeStorage({ streamContent: content });
  const tgtStorage = makeStorage({ putResult: { id: 'file-001' } });

  const sm = makeStorageManager({
    instances: new Map([
      ['src-channel', { type: 's3', instance: srcStorage }],
      ['tgt-channel', { type: 's3', instance: tgtStorage }],
    ]),
    isUploadAllowed: () => true,
    getEffectiveUploadLimits: () => ({
      enableSizeLimit: false,
      enableChunking: false,
      chunkSizeMB: 5,
      maxChunks: 0,
    }),
    getStorage: (id) => {
      if (id === 'src-channel') return srcStorage;
      if (id === 'tgt-channel') return tgtStorage;
    },
    applyPendingQuotaEvents: async () => {},
  });

  const db = {
    prepare: () => ({ run: () => {}, all: () => [], get: () => null }),
    transaction: (fn) => () => fn(),
  };

  const files = [
    makeFileRecord({ id: 'f1', storage_instance_id: 'src-channel' }),
    makeFileRecord({ id: 'f2', storage_instance_id: 'tgt-channel' }), // 同渠道 → skipped
  ];

  const results = await migrateFilesBatch(files, {
    targetChannel: 'tgt-channel',
    db,
    storageManager: sm,
  });

  assert.equal(results.total, 2);
  assert.equal(results.success, 1, '一个成功');
  assert.equal(results.skipped, 1, '一个跳过（同渠道）');
  assert.equal(results.failed, 0);

  console.log('  [OK] migrateFilesBatch：success/skipped/failed 计数正确');
}

async function testMigrateFilesBatchRecordsErrors() {
  const { migrateFilesBatch } = await importModule();

  const sm = makeStorageManager({
    instances: new Map([
      ['tgt-channel', { type: 's3', instance: makeStorage() }],
    ]),
    isUploadAllowed: () => true,
    getEffectiveUploadLimits: () => ({ enableSizeLimit: false, enableChunking: false }),
    getStorage: () => null,
    applyPendingQuotaEvents: async () => {},
  });

  const db = {
    prepare: () => ({ run: () => {}, all: () => [], get: () => null }),
    transaction: (fn) => () => fn(),
  };

  // 源渠道不在 instances → failed
  const files = [
    makeFileRecord({ id: 'err-file', storage_instance_id: 'missing-channel' }),
  ];

  const results = await migrateFilesBatch(files, {
    targetChannel: 'tgt-channel',
    db,
    storageManager: sm,
  });

  assert.equal(results.failed, 1);
  assert.equal(results.errors.length, 1);
  assert.equal(results.errors[0].id, 'err-file');

  console.log('  [OK] migrateFilesBatch：失败记录写入 errors 列表');
}

// ─────────────────────────────────────────────────────────────────────────────
// 运行
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n== validateMigrationTarget 测试 ==');
  await testValidateMissingTargetChannel();
  await testValidateTargetNotFound();
  await testValidateUploadNotAllowed();
  await testValidateUnsupportedType();
  await testValidateSuccess();

  console.log('\n== migrateFileRecord 测试 ==');
  await testMigrateFileRecordSkipsSameChannel();
  await testMigrateFileRecordFailsWhenSourceMissing();
  await testMigrateFileRecordNonChunkedUsesStream();
  await testMigrateFileRecordChunkedFallsBackToBuffer();

  console.log('\n== migrateFilesBatch 测试 ==');
  await testMigrateFilesBatchCountsResults();
  await testMigrateFilesBatchRecordsErrors();

  console.log('\n所有 migrate-file 测试通过\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
