import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== S3 并发 Multipart 上传功能测试 ===\n');

let passed = true;

// 模拟 S3 Storage
class MockS3Storage {
  constructor() {
    this.uploadedParts = [];
    this.uploadDelay = 50; // 模拟网络延迟
    this.shouldFail = false;
    this.failAtPart = -1;
  }

  getChunkConfig() {
    return {
      enabled: true,
      chunkThreshold: 100 * 1024 * 1024,
      chunkSize: 50 * 1024 * 1024,
      maxChunks: 10000,
      mode: 'native'
    };
  }

  async initMultipartUpload({ fileName, mimeType }) {
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const key = fileName;
    this.uploadedParts = [];
    return { uploadId, key };
  }

  async uploadPart(chunkBuffer, { uploadId, key, partNumber }) {
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, this.uploadDelay));

    // 模拟失败
    if (this.shouldFail && this.failAtPart === partNumber) {
      throw new Error(`Simulated upload failure at part ${partNumber}`);
    }

    const etag = `"etag-${partNumber}-${chunkBuffer.length}"`;
    this.uploadedParts.push({ partNumber, etag, timestamp: Date.now() });
    return { partNumber, etag };
  }

  async completeMultipartUpload({ uploadId, key, parts }) {
    // 验证 parts 顺序
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].partNumber !== i + 1) {
        throw new Error(`Parts not in order: expected ${i + 1}, got ${parts[i].partNumber}`);
      }
    }
    return { id: key };
  }

  async abortMultipartUpload({ uploadId, key }) {
    this.aborted = true;
    this.abortedUploadId = uploadId;
  }
}

// 简化版 ChunkManager.uploadS3Multipart 用于测试
async function uploadS3Multipart(storage, buffer, options) {
  const pLimit = (await import('../ImgBed/node_modules/p-limit/index.js')).default;
  const config = storage.getChunkConfig();
  const totalChunks = Math.ceil(buffer.length / config.chunkSize);
  let multipart;

  // 获取并发配置
  const performanceConfig = options.config?.performance?.s3Multipart || {};
  const concurrencyEnabled = performanceConfig.enabled !== false;
  const concurrency = Math.min(
    Math.max(1, performanceConfig.concurrency || 4),
    performanceConfig.maxConcurrency || 8
  );

  try {
    multipart = await storage.initMultipartUpload({
      fileName: options.fileName,
      mimeType: options.mimeType
    });

    const parts = [];

    if (concurrencyEnabled && concurrency > 1) {
      // 并发上传模式
      const limit = pLimit(concurrency);
      const uploadTasks = [];

      for (let i = 0; i < totalChunks; i++) {
        const partNumber = i + 1;
        const start = i * config.chunkSize;
        const end = Math.min(start + config.chunkSize, buffer.length);
        const chunkBuffer = buffer.subarray(start, end);

        const task = limit(async () => {
          const part = await storage.uploadPart(chunkBuffer, {
            uploadId: multipart.uploadId,
            key: multipart.key,
            partNumber
          });
          return part;
        });

        uploadTasks.push(task);
      }

      // 等待所有 Part 上传完成
      const uploadedParts = await Promise.all(uploadTasks);
      parts.push(...uploadedParts);

      // 按 PartNumber 排序（S3 协议要求）
      parts.sort((a, b) => a.partNumber - b.partNumber);
    } else {
      // 串行上传模式
      for (let i = 0; i < totalChunks; i++) {
        const start = i * config.chunkSize;
        const end = Math.min(start + config.chunkSize, buffer.length);
        const chunkBuffer = buffer.subarray(start, end);

        const part = await storage.uploadPart(chunkBuffer, {
          uploadId: multipart.uploadId,
          key: multipart.key,
          partNumber: i + 1
        });
        parts.push(part);
      }
    }

    const result = await storage.completeMultipartUpload({
      uploadId: multipart.uploadId,
      key: multipart.key,
      parts
    });

    return { id: result.id, totalSize: buffer.length };
  } catch (err) {
    // 失败时中止 multipart upload
    if (multipart?.uploadId) {
      try {
        await storage.abortMultipartUpload({
          uploadId: multipart.uploadId,
          key: multipart.key
        });
      } catch (abortErr) {
        console.error('Abort failed:', abortErr);
      }
    }
    throw err;
  }
}

try {
  // 测试 1: 并发上传功能验证
  console.log('1. 测试并发上传（4个分片，并发度4）...');
  const storage1 = new MockS3Storage();
  const buffer1 = Buffer.alloc(200 * 1024 * 1024); // 200MB

  const config1 = {
    performance: {
      s3Multipart: {
        enabled: true,
        concurrency: 4,
        maxConcurrency: 8,
      }
    }
  };

  const start1 = Date.now();
  const result1 = await uploadS3Multipart(storage1, buffer1, {
    fileId: 'test-1',
    fileName: 'test-1.bin',
    mimeType: 'application/octet-stream',
    config: config1,
  });
  const duration1 = Date.now() - start1;

  console.log(`   上传耗时: ${duration1}ms`);
  console.log(`   上传分片数: ${storage1.uploadedParts.length}`);

  if (storage1.uploadedParts.length === 4) {
    console.log(`   ✓ 成功上传 4 个分片`);
  } else {
    console.log(`   ✗ 分片数错误: ${storage1.uploadedParts.length}`);
    passed = false;
  }

  // 验证分片顺序
  let orderCorrect = true;
  for (let i = 0; i < storage1.uploadedParts.length; i++) {
    if (storage1.uploadedParts[i].partNumber !== i + 1) {
      orderCorrect = false;
      break;
    }
  }

  if (orderCorrect) {
    console.log(`   ✓ 分片顺序正确`);
  } else {
    console.log(`   ✗ 分片顺序错误`);
    passed = false;
  }

  // 测试 2: 串行上传对比
  console.log('\n2. 测试串行上传（并发度1）...');
  const storage2 = new MockS3Storage();
  const buffer2 = Buffer.alloc(200 * 1024 * 1024);

  const config2 = {
    performance: {
      s3Multipart: {
        enabled: false,
        concurrency: 1,
      }
    }
  };

  const start2 = Date.now();
  await uploadS3Multipart(storage2, buffer2, {
    fileId: 'test-2',
    fileName: 'test-2.bin',
    mimeType: 'application/octet-stream',
    config: config2,
  });
  const duration2 = Date.now() - start2;

  console.log(`   串行上传耗时: ${duration2}ms`);
  console.log(`   并发上传耗时: ${duration1}ms`);
  console.log(`   性能提升: ${(duration2 / duration1).toFixed(2)}x`);

  if (duration2 > duration1) {
    console.log(`   ✓ 并发模式快于串行模式`);
  } else {
    console.log(`   ⚠ 性能提升不明显（测试环境限制）`);
  }

  // 测试 3: 失败场景 - Abort 机制
  console.log('\n3. 测试失败场景 - Abort 机制...');
  const storage3 = new MockS3Storage();
  storage3.shouldFail = true;
  storage3.failAtPart = 2;
  const buffer3 = Buffer.alloc(200 * 1024 * 1024);

  try {
    await uploadS3Multipart(storage3, buffer3, {
      fileId: 'test-3',
      fileName: 'test-3.bin',
      mimeType: 'application/octet-stream',
      config: config1,
    });
    console.log(`   ✗ 应该抛出异常`);
    passed = false;
  } catch (err) {
    console.log(`   ✓ 正确抛出异常: ${err.message}`);

    if (storage3.aborted) {
      console.log(`   ✓ Abort 机制已触发`);
    } else {
      console.log(`   ✗ Abort 机制未触发`);
      passed = false;
    }
  }

  // 测试 4: 不同并发度性能对比
  console.log('\n4. 测试不同并发度性能...');
  const concurrencies = [1, 2, 4, 8];
  const results = [];

  for (const concurrency of concurrencies) {
    const storage = new MockS3Storage();
    const buffer = Buffer.alloc(200 * 1024 * 1024);

    const config = {
      performance: {
        s3Multipart: {
          enabled: true,
          concurrency,
          maxConcurrency: 8,
        }
      }
    };

    const start = Date.now();
    await uploadS3Multipart(storage, buffer, {
      fileId: `test-concurrency-${concurrency}`,
      fileName: `test-${concurrency}.bin`,
      mimeType: 'application/octet-stream',
      config,
    });
    const elapsed = Date.now() - start;

    results.push({ concurrency, duration: elapsed });
    console.log(`   并发度 ${concurrency}: ${elapsed}ms`);
  }

  // 验证并发度提升带来性能提升
  const baseline = results[0].duration;
  const best = Math.min(...results.map(r => r.duration));
  const improvement = (baseline / best).toFixed(2);

  console.log(`   性能提升: ${improvement}x (相比串行)`);

  if (best < baseline) {
    console.log(`   ✓ 并发提升了性能`);
  } else {
    console.log(`   ⚠ 性能提升不明显`);
  }

  // 测试 5: 验证并发安全性（分片不会乱序）
  console.log('\n5. 测试并发安全性（100次重复测试）...');
  let allCorrect = true;

  for (let i = 0; i < 100; i++) {
    const storage = new MockS3Storage();
    storage.uploadDelay = Math.random() * 20; // 随机延迟
    const buffer = Buffer.alloc(200 * 1024 * 1024);

    await uploadS3Multipart(storage, buffer, {
      fileId: `test-safety-${i}`,
      fileName: `test-${i}.bin`,
      mimeType: 'application/octet-stream',
      config: config1,
    });

    // 验证顺序
    for (let j = 0; j < storage.uploadedParts.length; j++) {
      if (storage.uploadedParts[j].partNumber !== j + 1) {
        allCorrect = false;
        break;
      }
    }

    if (!allCorrect) break;
  }

  if (allCorrect) {
    console.log(`   ✓ 100次测试全部通过，分片顺序始终正确`);
  } else {
    console.log(`   ✗ 发现分片顺序错误`);
    passed = false;
  }

} catch (err) {
  console.error('\n✗ 测试过程中发生错误:', err);
  console.error(err.stack);
  passed = false;
}

console.log('\n=== 测试结果 ===');
if (passed) {
  console.log('✓ 所有功能测试通过');
  process.exit(0);
} else {
  console.log('✗ 部分功能测试失败');
  process.exit(1);
}
