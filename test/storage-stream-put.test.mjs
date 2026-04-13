import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';

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

let S3Storage;
async function loadS3WithStubs() {
  if (!S3Storage) {
    const mod = await import('../ImgBed/src/storage/s3.js');
    S3Storage = mod.default;
  }

  const FakeCommand = class {
    constructor(input) {
      this.input = input;
    }
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
  storage.s3 = fakeS3;
  return storage;
}

async function testS3PutAcceptsBuffer() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const buf = Buffer.from('hello-buffer');
  const result = await storage.put(buf, { fileName: 'test.txt', mimeType: 'text/plain' });

  assert.ok(Buffer.isBuffer(cap.body), 'Buffer 输入：body 应为 Buffer');
  assert.deepEqual(cap.body, buf, 'Buffer 输入：body 内容应一致');
  assert.equal(result.storageKey, 'test.txt');
  assert.equal(result.size, buf.length);
  assert.equal(result.deleteToken, null);
  assert.equal(result.raw, null);
  console.log('  [OK] S3Storage.put：Buffer 输入返回 canonical 结构');
}

async function testS3PutAcceptsNodeReadable() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const readable = makeNodeReadable('hello-node-stream');
  const result = await storage.put(readable, { fileName: 'test.txt', mimeType: 'text/plain', contentLength: 17 });

  assert.ok(cap.body instanceof Readable, 'Node Readable 输入：body 应为 Node Readable');
  assert.equal(cap.body, readable, 'Node Readable 输入：应保持原始 readable');
  assert.equal(cap.contentLength, 17, '显式 contentLength 应透传给 S3');
  assert.equal(result.storageKey, 'test.txt');
  assert.equal(result.size, 17);
  console.log('  [OK] S3Storage.put：Node Readable 输入返回 canonical 结构');
}

async function testS3PutAcceptsWebReadableStream() {
  await loadS3WithStubs();
  const cap = {};
  const storage = makeS3StorageWithFakeClient(cap);

  const webStream = makeWebReadableStream('hello-web-stream');
  const result = await storage.put(webStream, { fileName: 'test.txt', contentLength: 16 });

  assert.ok(cap.body instanceof Readable, 'Web ReadableStream 输入：应被转换为 Node Readable');
  assert.equal(cap.contentLength, 16);
  assert.equal(result.storageKey, 'test.txt');
  assert.equal(result.size, 16);
  console.log('  [OK] S3Storage.put：Web ReadableStream 输入被统一为 Node Readable');
}

async function testS3PutThrowsWhenMissingFileName() {
  await loadS3WithStubs();
  const storage = makeS3StorageWithFakeClient({});

  await assert.rejects(
    () => storage.put(Buffer.from('x'), { mimeType: 'text/plain' }),
    /缺少 fileName/
  );
  console.log('  [OK] S3Storage.put：缺少 fileName 抛出中文错误');
}

async function testHFPutAcceptsMultipleBinaryInputs() {
  const { default: HFStorage } = await import('../ImgBed/src/storage/huggingface.js');
  const storage = new HFStorage({ token: 't', repo: 'user/repo' });

  let receivedFilesData;
  storage.commit = async (_msg, filesData) => {
    receivedFilesData = filesData;
    return {};
  };

  const bufferResult = await storage.put(Buffer.from('hf-buffer-content'), {
    fileName: 'img-buffer.png',
    originalName: 'img-buffer.png',
  });
  assert.equal(bufferResult.storageKey, 'img-buffer.png');
  assert.equal(bufferResult.size, 'hf-buffer-content'.length);
  assert.equal(bufferResult.deleteToken, null);
  assert.ok(Buffer.isBuffer(receivedFilesData['img-buffer.png']));

  const streamResult = await storage.put(makeNodeReadable('hf-node-stream-content'), {
    fileName: 'img-stream.png',
  });
  assert.equal(streamResult.storageKey, 'img-stream.png');
  assert.equal(streamResult.size, 'hf-node-stream-content'.length);
  assert.ok(Buffer.isBuffer(receivedFilesData['img-stream.png']));

  const webResult = await storage.put(makeWebReadableStream('hf-web-stream-content'), {
    fileName: 'img-web.png',
  });
  assert.equal(webResult.storageKey, 'img-web.png');
  assert.equal(webResult.size, 'hf-web-stream-content'.length);
  assert.ok(Buffer.isBuffer(receivedFilesData['img-web.png']));
  console.log('  [OK] HuggingFaceStorage.put：多种二进制输入均收敛到 canonical 结构');
}

async function testHFPutThrowsWhenMissingFileName() {
  const { default: HFStorage } = await import('../ImgBed/src/storage/huggingface.js');
  const storage = new HFStorage({ token: 't', repo: 'user/repo' });
  storage.commit = async () => ({});

  await assert.rejects(
    () => storage.put(Buffer.from('x'), {}),
    /缺少 fileName/
  );
  console.log('  [OK] HuggingFaceStorage.put：缺少 fileName 抛出中文错误');
}

async function run() {
  console.log('\n== storage stream / put canonical contract tests ==');
  await testS3PutAcceptsBuffer();
  await testS3PutAcceptsNodeReadable();
  await testS3PutAcceptsWebReadableStream();
  await testS3PutThrowsWhenMissingFileName();
  await testHFPutAcceptsMultipleBinaryInputs();
  await testHFPutThrowsWhenMissingFileName();
  console.log('\nstorage-stream-put tests passed\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
