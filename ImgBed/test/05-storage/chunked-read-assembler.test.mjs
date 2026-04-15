import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createChunkedReadStream } from '../../src/storage/read/chunked-read-assembler.js';

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test('chunked-read-assembler 会按分块交集范围读取并拼装结果', async () => {
  const payloads = {
    'chunk-0': Buffer.from('abcd'),
    'chunk-1': Buffer.from('efgh'),
  };

  const stream = createChunkedReadStream([
    { storage_id: 'storage-1', storage_key: 'chunk-0', size: 4 },
    { storage_id: 'storage-1', storage_key: 'chunk-1', size: 4 },
  ], () => ({
    async getChunkStreamResponse(storageKey, options) {
      return {
        stream: Readable.from([payloads[storageKey].subarray(options.start, options.end + 1)]),
        statusCode: 206,
      };
    },
  }), {
    start: 2,
    end: 5,
    totalSize: 8,
  });

  assert.equal(await readStream(stream), 'cdef');
});

test('chunked-read-assembler 会在驱动返回整块时本地裁剪', async () => {
  const stream = createChunkedReadStream([
    { storage_id: 'storage-1', storage_key: 'chunk-0', size: 4 },
  ], () => ({
    async getChunkStreamResponse() {
      return {
        stream: Readable.from([Buffer.from('abcd')]),
        statusCode: 200,
      };
    },
  }), {
    start: 1,
    end: 2,
    totalSize: 4,
  });

  assert.equal(await readStream(stream), 'bc');
});

test('chunked-read-assembler 会在分块渠道缺失时抛错', async () => {
  const stream = createChunkedReadStream([
    { storage_id: 'missing', storage_key: 'chunk-0', size: 4 },
  ], () => null, {
    totalSize: 4,
  });

  await assert.rejects(() => readStream(stream), /分块渠道 missing 不可用/);
});
