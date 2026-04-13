import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import LocalStorage from '../ImgBed/src/storage/local.js';
import TelegramStorage from '../ImgBed/src/storage/telegram.js';
import DiscordStorage from '../ImgBed/src/storage/discord.js';
import ExternalStorage from '../ImgBed/src/storage/external.js';

function makeWebStream(content) {
  const buffer = Buffer.from(content);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    }
  });
}

async function readWebStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function testLocalStorageGetStreamResponse() {
  const basePath = path.join(process.env.IMGBED_APP_ROOT, 'local-read-contract');
  fs.mkdirSync(basePath, { recursive: true });
  const storage = new LocalStorage({ basePath });
  const fileId = 'abcd_test-file';
  await storage.put(Buffer.from('hello-local'), { id: fileId });

  const full = await storage.getStreamResponse(fileId);
  const partial = await storage.getStreamResponse(fileId, { start: 1, end: 3 });

  assert.equal(full.contentLength, 11);
  assert.equal(full.totalSize, 11);
  assert.equal(full.statusCode, 200);
  assert.equal(full.acceptRanges, true);

  const partialBody = await new Promise((resolve, reject) => {
    const chunks = [];
    partial.stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    partial.stream.on('end', () => resolve(Buffer.concat(chunks)));
    partial.stream.on('error', reject);
  });

  assert.equal(partial.contentLength, 3);
  assert.equal(partial.totalSize, 11);
  assert.equal(partial.statusCode, 206);
  assert.equal(partialBody.toString(), 'ell');
  console.log('  [OK] LocalStorage.getStreamResponse：完整返回 rich result');
}

async function testTelegramGetStreamResponse() {
  const storage = new TelegramStorage({ botToken: 'token', chatId: 'chat-id' });
  storage.getFileContent = async () => ({
    ok: true,
    status: 206,
    headers: new Headers({
      'content-length': '3',
      'content-range': 'bytes 0-2/7',
      'accept-ranges': 'bytes',
    }),
    body: makeWebStream('abc'),
  });

  const result = await storage.getStreamResponse('file-id', { start: 0, end: 2 });
  const body = await readWebStream(result.stream);

  assert.equal(result.contentLength, 3);
  assert.equal(result.totalSize, 7);
  assert.equal(result.statusCode, 206);
  assert.equal(result.acceptRanges, true);
  assert.equal(body.toString(), 'abc');
  console.log('  [OK] TelegramStorage.getStreamResponse：返回 canonical rich result');
}

async function testDiscordGetStreamResponse() {
  const storage = new DiscordStorage({ botToken: 'token', channelId: 'default-channel' });
  storage.getFileURL = async () => 'https://cdn.example.com/file.jpg';
  storage.requestDiscord = async (_url, options = {}) => {
    assert.equal(options.headers.Range, 'bytes=1-2');
    return {
      ok: true,
      status: 206,
      headers: new Headers({
        'content-length': '2',
        'content-range': 'bytes 1-2/5',
        'accept-ranges': 'bytes',
      }),
      body: makeWebStream('bc'),
    };
  };

  const result = await storage.getStreamResponse('channel/message', { start: 1, end: 2 });
  const body = await readWebStream(result.stream);

  assert.equal(result.contentLength, 2);
  assert.equal(result.totalSize, 5);
  assert.equal(result.statusCode, 206);
  assert.equal(result.acceptRanges, true);
  assert.equal(body.toString(), 'bc');
  console.log('  [OK] DiscordStorage.getStreamResponse：返回 canonical rich result');
}

async function testExternalStorageGetStreamResponse() {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    assert.equal(options.headers.Range, 'bytes=0-3');
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': '4',
      }),
      body: makeWebStream('abcd'),
    };
  };

  try {
    const storage = new ExternalStorage({ baseUrl: 'https://cdn.example.com/' });
    const result = await storage.getStreamResponse('file.jpg', { start: 0, end: 3 });
    const body = await readWebStream(result.stream);

    assert.equal(result.contentLength, 4);
    assert.equal(result.totalSize, 4);
    assert.equal(result.statusCode, 200);
    assert.equal(result.acceptRanges, false);
    assert.equal(body.toString(), 'abcd');
    console.log('  [OK] ExternalStorage.getStreamResponse：返回 canonical rich result');
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  console.log('\n== storage read contract tests ==');
  await testLocalStorageGetStreamResponse();
  await testTelegramGetStreamResponse();
  await testDiscordGetStreamResponse();
  await testExternalStorageGetStreamResponse();
  console.log('\nstorage-read-contract tests passed\n');
}

run().catch((err) => {
  console.error('\n测试失败:', err);
  process.exit(1);
});
