import { strict as assert } from 'node:assert';
import { PassThrough, Readable } from 'node:stream';
import { once } from 'node:events';

import { handleRegularStream } from '../ImgBed/src/services/view/handle-stream.js';

function createResponseRecorder() {
  const res = new PassThrough();
  const headers = new Map();

  res.setHeader = (key, value) => {
    headers.set(String(key).toLowerCase(), String(value));
  };
  res.getHeader = (key) => headers.get(String(key).toLowerCase());
  res.removeHeader = (key) => headers.delete(String(key).toLowerCase());
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.jsonPayload = payload;
    res.end();
    return res;
  };

  return { res, headers };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function testTelegramResponseUsesUpstreamContentLength() {
  const payload = Buffer.from('tg-data');
  const storage = {
    async getStreamResponse() {
      return {
        stream: Readable.from([payload]),
        contentLength: payload.length,
        totalSize: payload.length,
        statusCode: 200,
        acceptRanges: false,
      };
    },
  };

  const { res, headers } = createResponseRecorder();
  const fileRecord = {
    id: 'file-1',
    size: 1024,
    mime_type: 'image/jpeg',
    original_name: 'tg.jpg',
  };

  const waitForFinish = once(res, 'finish');
  await handleRegularStream(fileRecord, res, storage, 'tg-key', {
    start: 0,
    end: fileRecord.size - 1,
    isPartial: false,
    etag: '"etag"',
    lastModified: '2026-04-14T00:00:00.000Z',
  });
  const body = await readAll(res);
  await waitForFinish;

  assert.equal(res.statusCode, 200, '普通读取应返回 200');
  assert.equal(headers.get('content-length'), String(payload.length), '应使用上游真实长度覆盖数据库长度');
  assert.equal(headers.has('accept-ranges'), false, '当上游未声明范围能力时不应回写 Accept-Ranges');
  assert.equal(body.toString(), payload.toString(), '响应体应完整透传');
  console.log('  [OK] handleRegularStream：普通 TG 回源使用真实 Content-Length');
}

async function testIgnoredRangeFallsBackToRegularResponse() {
  const payload = Buffer.from('full-body');
  const storage = {
    async getStreamResponse() {
      return {
        stream: Readable.from([payload]),
        contentLength: payload.length,
        totalSize: payload.length,
        statusCode: 200,
        acceptRanges: false,
      };
    },
  };

  const { res, headers } = createResponseRecorder();
  const fileRecord = {
    id: 'file-2',
    size: 2048,
    mime_type: 'image/jpeg',
    original_name: 'tg.jpg',
  };

  const waitForFinish = once(res, 'finish');
  await handleRegularStream(fileRecord, res, storage, 'tg-key', {
    start: 0,
    end: 2,
    isPartial: true,
    etag: null,
    lastModified: null,
  });
  await readAll(res);
  await waitForFinish;

  assert.equal(res.statusCode, 200, '当上游忽略 Range 时应降级为普通 200');
  assert.equal(headers.has('content-range'), false, '不应伪造 Content-Range');
  assert.equal(headers.get('content-length'), String(payload.length), '长度应保持为实际全量长度');
  console.log('  [OK] handleRegularStream：上游忽略 Range 时回退为普通响应');
}

async function testPartialResponseUsesUpstreamRangeMetadata() {
  const payload = Buffer.from('abc');
  const storage = {
    async getStreamResponse() {
      return {
        stream: Readable.from([payload]),
        contentLength: payload.length,
        totalSize: 7,
        statusCode: 206,
        acceptRanges: true,
      };
    },
  };

  const { res, headers } = createResponseRecorder();
  const fileRecord = {
    id: 'file-3',
    size: 999,
    mime_type: 'image/jpeg',
    original_name: 'tg.jpg',
  };

  const waitForFinish = once(res, 'finish');
  await handleRegularStream(fileRecord, res, storage, 'tg-key', {
    start: 0,
    end: 2,
    isPartial: true,
    etag: null,
    lastModified: null,
  });
  await readAll(res);
  await waitForFinish;

  assert.equal(res.statusCode, 206, '上游返回 206 时应保持分段响应');
  assert.equal(headers.get('content-range'), 'bytes 0-2/7', '应使用上游总长度生成 Content-Range');
  assert.equal(headers.get('content-length'), String(payload.length), '应使用上游片段长度');
  assert.equal(headers.get('accept-ranges'), 'bytes', '支持 Range 时应保留 Accept-Ranges');
  console.log('  [OK] handleRegularStream：分段响应使用上游范围元数据');
}

async function run() {
  console.log('\n== view stream header alignment tests ==');
  await testTelegramResponseUsesUpstreamContentLength();
  await testIgnoredRangeFallsBackToRegularResponse();
  await testPartialResponseUsesUpstreamRangeMetadata();
  console.log('\nview-stream-header-alignment tests passed\n');
}

run().catch((error) => {
  console.error('\n测试失败:', error);
  process.exit(1);
});
