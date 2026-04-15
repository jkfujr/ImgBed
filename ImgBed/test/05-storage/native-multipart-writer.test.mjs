import assert from 'node:assert/strict';
import test from 'node:test';

import { writeNativeMultipartObject } from '../../src/storage/write/native-multipart-writer.js';

test('native-multipart-writer 会完成 multipart 并按升序提交 parts', async () => {
  const calls = [];
  const result = await writeNativeMultipartObject({
    storage: {
      async initMultipartUpload(args) {
        calls.push({ step: 'init', args });
        return {
          uploadId: 'u-1',
          key: 'multipart-key',
        };
      },
      async uploadPart(buffer, args) {
        calls.push({ step: 'part', size: buffer.length, args });
        return {
          partNumber: args.partNumber,
          etag: `etag-${args.partNumber}`,
        };
      },
      async completeMultipartUpload(args) {
        calls.push({ step: 'complete', args });
        return {
          storageKey: 'multipart-key',
          size: 2 * 1024 * 1024,
          deleteToken: { uploadId: 'u-1' },
        };
      },
      async abortMultipartUpload() {
        calls.push({ step: 'abort' });
      },
    },
    buffer: Buffer.alloc(2 * 1024 * 1024),
    fileName: 'demo.png',
    mimeType: 'image/png',
    chunkConfig: {
      chunkSize: 1024 * 1024,
    },
    config: {
      performance: {
        s3Multipart: {
          enabled: true,
          concurrency: 2,
        },
      },
    },
  });

  assert.equal(result.storageKey, 'multipart-key');
  assert.deepEqual(calls[calls.length - 1], {
    step: 'complete',
    args: {
      uploadId: 'u-1',
      key: 'multipart-key',
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
      ],
    },
  });
});

test('native-multipart-writer 会在上传失败时中止 multipart', async () => {
  const calls = [];

  await assert.rejects(() => writeNativeMultipartObject({
    storage: {
      async initMultipartUpload() {
        return {
          uploadId: 'u-2',
          key: 'broken-key',
        };
      },
      async uploadPart(buffer, args) {
        calls.push({ step: 'part', size: buffer.length, args });
        throw new Error('part failed');
      },
      async completeMultipartUpload() {
        throw new Error('should not complete');
      },
      async abortMultipartUpload(args) {
        calls.push({ step: 'abort', args });
      },
    },
    buffer: Buffer.alloc(1024 * 1024),
    fileName: 'broken.png',
    mimeType: 'image/png',
    chunkConfig: {
      chunkSize: 1024 * 1024,
    },
  }), /part failed/);

  assert.deepEqual(calls[calls.length - 1], {
    step: 'abort',
    args: {
      uploadId: 'u-2',
      key: 'broken-key',
    },
  });
});
