/**
 * 存储驱动流式 put 单元测试
 * 覆盖范围：
 *   - S3Storage.put：Buffer / Node Readable / Web ReadableStream 三种输入
 *   - HuggingFaceStorage.put：Buffer / Node Readable / Web ReadableStream 三种输入
 */

import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';

// ─────────────────────────────────────────────
// 辅助：把字符串内容包成不同类型的"流"
// ─────────────────────────────────────────────
function makeNodeReadable(content) {
  return Readable.from([Buffer.from(content)]);
}

function makeWebReadableStream(content) {
  const buf = Buffer.from(content);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    }
  });
}

// ─────────────────────────────────────────────
// S3 模块级 stub 注入
// PutObjectCommand 是模块级变量，注入 storage.s3 不够，
// 还需通过 __setCommandsForTest 替换命令构造函数。
// ─────────────────────────────────────────────
let S3Storage;
async function loadS3WithStubs() {
  if (!S3Storage) {
    const mod = await import('../ImgBed/src/storage/s3.js');
    S3Storage = mod.default;
  }
  // 注入伪命令构造函数：记录 input，返回带 input 属性的对象
  const FakeCommand = class {
    constructor(input) { this.input = input; }
  };
  S3Storage.__setCommandsForTest({
    PutObjectCommand: FakeCommand,
    GetObjectCommand: FakeCommand,
    DeleteObjectCommand: FakeCommand,
    HeadObjectCommand: FakeCommand,
  });
  return S3Storage;
}

function makeS3StorageWithFakeClient(captureRef) {
  const fakeS3 = {
    send: async (cmd) => {
      captureRef.body = cmd.input.Body;
      captureRef.contentLength = cmd.input.ContentLength;
      captureRef.cmd = cmd;
    }
  };
  const storage = new S3Storage({ bucket: 'test', region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'x' });
  // 直接注入：_ensureInitialized 检查 this.s3 非 null 即返回
  storage.s3 = fakeS3;
  return storage;
}

// ─────────────────────────────────────────────
// S3Storage.put 测试
// ─────────────────────────────────────────────
async function testS3PutAcceptsBuffer() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const buf = Buffer.from('hello-buffer');
  await storage.put(buf, { fileName: 'test.txt', mimeType: 'text/plain' });

  assert.ok(Buffer.isBuffer(cap.body), 'Buffer 输入：body 应为 Buffer');
  assert.deepEqual(cap.body, buf, 'Buffer 输入：body 内容应一致');
  assert.equal(cap.contentLength, undefined, 'Buffer 输入：不传 contentLength 时不应设置');

  console.log('  [OK] S3Storage.put：Buffer 输入');
}

async function testS3PutAcceptsNodeReadable() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const readable = makeNodeReadable('hello-node-stream');
  await storage.put(readable, { fileName: 'test.txt', mimeType: 'text/plain', contentLength: 17 });

  assert.ok(cap.body instanceof Readable, 'Node Readable 输入：body 应直接是 Readable');
  assert.equal(cap.body, readable, 'Node Readable 输入：应是原始 readable');

  console.log('  [OK] S3Storage.put：Node Readable 输入');
}

async function testS3PutAcceptsWebReadableStream() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const webStream = makeWebReadableStream('hello-web-stream');
  await storage.put(webStream, { fileName: 'test.txt', contentLength: 16 });

  assert.ok(cap.body instanceof ReadableStream, 'Web ReadableStream 输入：body 应直接是 ReadableStream');

  console.log('  [OK] S3Storage.put：Web ReadableStream 输入');
}

async function testS3PutSetsContentLengthWhenProvided() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const readable = makeNodeReadable('data');
  await storage.put(readable, { fileName: 'test.txt', contentLength: 4 });

  assert.equal(cap.contentLength, 4, 'contentLength 选项应被透传到 CommandParams');
  console.log('  [OK] S3Storage.put：contentLength 透传');
}

async function testS3PutThrowsWhenMissingFileName() {
  await loadS3WithStubs();
  const storage = makeS3StorageWithFakeClient({});

  await assert.rejects(
    () => storage.put(Buffer.from('x'), { mimeType: 'text/plain' }),
    /missing fileName/i
  );
  console.log('  [OK] S3Storage.put：缺少 fileName 抛出错误');
}

// ─────────────────────────────────────────────
// HuggingFaceStorage.put 测试
// ─────────────────────────────────────────────
async function testHFPutAcceptsBuffer() {
  const { default: HFStorage } = await import('../ImgBed/src/storage/huggingface.js');
  const storage = new HFStorage({ token: 't', repo: 'user/repo' });

  let receivedFilesData;
  storage.commit = async (_msg, filesData) => { receivedFilesData = filesData; return {}; };

  const buf = Buffer.from('hf-buffer-content');
  await storage.put(buf, { fileName: 'img.png', originalName: 'img.png' });

  assert.ok(receivedFilesData['img.png'], 'Buffer 输入：filesData 应有目标 key');
  const body = receivedFilesData['img.png'];
  assert.ok(Buffer.isBuffer(body) || body instanceof ArrayBuffer, 'Buffer 输入：内容应是 Buffer/ArrayBuffer');
  console.log('  [OK] HuggingFaceStorage.put：Buffer 输入');
}

async function testHFPutAcceptsNodeReadable() {
  const { default: HFStorage } = await import('../ImgBed/src/storage/huggingface.js');
  const storage = new HFStorage({ token: 't', repo: 'user/repo' });

  let receivedFilesData;
  storage.commit = async (_msg, filesData) => { receivedFilesData = filesData; return {}; };

  const content = 'hf-node-stream-content';
  const readable = makeNodeReadable(content);
  await storage.put(readable, { fileName: 'img.png' });

  const body = receivedFilesData['img.png'];
  assert.ok(Buffer.isBuffer(body), 'Node Readable 输入：收集后应为 Buffer');
  assert.equal(body.toString(), content, 'Node Readable 输入：内容应正确');
  console.log('  [OK] HuggingFaceStorage.put：Node Readable 输入');
}

async function testHFPutAcceptsWebReadableStream() {
  const { default: HFStorage } = await import('../ImgBed/src/storage/huggingface.js');
  const storage = new HFStorage({ token: 't', repo: 'user/repo' });

  let receivedFilesData;
  storage.commit = async (_msg, filesData) => { receivedFilesData = filesData; return {}; };

  const content = 'hf-web-stream-content';
  const webStream = makeWebReadableStream(content);
  await storage.put(webStream, { fileName: 'img.png' });

  const body = receivedFilesData['img.png'];
  assert.ok(Buffer.isBuffer(body), 'Web ReadableStream 输入：收集后应为 Buffer');
  assert.equal(body.toString(), content, 'Web ReadableStream 输入：内容应正确');
  console.log('  [OK] HuggingFaceStorage.put：Web ReadableStream 输入');
}

async function testHFPutThrowsWhenMissingFileName() {
  const { default: HFStorage } = await import('../ImgBed/src/storage/huggingface.js');
  const storage = new HFStorage({ token: 't', repo: 'user/repo' });
  storage.commit = async () => ({});

  await assert.rejects(
    () => storage.put(Buffer.from('x'), {}),
    /Missing fileName/i
  );
  console.log('  [OK] HuggingFaceStorage.put：缺少 fileName 抛出错误');
}

// ─────────────────────────────────────────────
// 运行所有测试
// ─────────────────────────────────────────────
async function run() {
  console.log('\n== S3Storage.put 流式支持测试 ==');
  await testS3PutAcceptsBuffer();
  await testS3PutAcceptsNodeReadable();
  await testS3PutAcceptsWebReadableStream();
  await testS3PutSetsContentLengthWhenProvided();
  await testS3PutThrowsWhenMissingFileName();

  console.log('\n== HuggingFaceStorage.put 流式支持测试 ==');
  await testHFPutAcceptsBuffer();
  await testHFPutAcceptsNodeReadable();
  await testHFPutAcceptsWebReadableStream();
  await testHFPutThrowsWhenMissingFileName();

  console.log('\n所有存储流式上传测试通过\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
