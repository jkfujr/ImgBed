const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { resolveFileStorage, resolveLegacyStorage, parseRangeHeader, buildStreamHeaders } = require('../src/services/view/resolve-file-storage');

function createStorageManager(storages = {}) {
  return {
    instances: new Map(Object.entries(storages).map(([id, entry]) => [id, entry])),
    getStorage(id) {
      const entry = this.instances.get(id);
      return entry ? entry.storage : null;
    },
  };
}

async function testResolveFileStorageWithInstanceId() {
  const storageManager = createStorageManager({
    'local-1': { storage: { type: 'local' } },
  });

  const fileRecord = {
    storage_channel: 'local',
    storage_config: JSON.stringify({ instance_id: 'local-1' }),
    storage_key: 'test.jpg',
  };

  const result = resolveFileStorage(fileRecord, { storageManager, config: {} });
  assert.deepEqual(result, { storage: { type: 'local' }, storageKey: 'test.jpg' });
}

async function testResolveFileStorageWithLegacyTelegram() {
  const storageManager = createStorageManager();
  const fileRecord = {
    storage_channel: 'telegram',
    storage_config: null,
    storage_key: 'tg-key',
    telegram_bot_token: 'bot123',
  };

  const result = resolveFileStorage(fileRecord, {
    storageManager,
    config: {
      storage: {
        storages: [
          {
            id: 'tg-1',
            type: 'telegram',
            config: {
              botToken: 'bot123',
              proxyUrl: 'socks5://127.0.0.1:1080',
            },
          },
        ],
      },
    },
  });
  assert.ok(result.storage);
  assert.equal(result.storageKey, 'tg-key');
  assert.equal(result.storage.proxyUrl, 'socks5://127.0.0.1:1080');
}

async function testResolveFileStorageWithLegacyExternal() {
  const storageManager = createStorageManager();
  const fileRecord = {
    storage_channel: 'external',
    storage_config: JSON.stringify({ original_meta: { Url: 'https://example.com/file.jpg' } }),
    storage_key: 'old-key',
  };

  const result = resolveFileStorage(fileRecord, { storageManager, config: {} });
  assert.ok(result.storage);
  assert.equal(result.storage._overrideKey, 'https://example.com/file.jpg');
}

async function testResolveFileStorageThrowsWhenMissing() {
  const storageManager = createStorageManager();
  const fileRecord = {
    storage_channel: 'unknown',
    storage_config: JSON.stringify({ instance_id: 'missing' }),
    storage_key: 'key',
  };

  try {
    resolveFileStorage(fileRecord, { storageManager, config: {} });
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 500);
    assert.ok(err.message.includes('图床渠道调度失败'));
  }
}

async function testParseRangeHeaderWithoutRange() {
  const result = parseRangeHeader(null, 1000);
  assert.deepEqual(result, { start: 0, end: 999, isPartial: false });
}

async function testParseRangeHeaderWithValidRange() {
  const result = parseRangeHeader('bytes=100-199', 1000);
  assert.deepEqual(result, { start: 100, end: 199, isPartial: true });
}

async function testParseRangeHeaderWithOpenEndRange() {
  const result = parseRangeHeader('bytes=500-', 1000);
  assert.deepEqual(result, { start: 500, end: 999, isPartial: true });
}

async function testParseRangeHeaderWithInvalidRange() {
  const result = parseRangeHeader('bytes=abc-def', 1000);
  assert.deepEqual(result, { start: 0, end: 999, isPartial: false });
}

async function testParseRangeHeaderClampsTotalSize() {
  const result = parseRangeHeader('bytes=100-2000', 1000);
  assert.deepEqual(result, { start: 100, end: 999, isPartial: true });
}

async function testBuildStreamHeadersForFullContent() {
  const fileRecord = {
    mime_type: 'image/jpeg',
    original_name: '测试.jpg',
  };

  const headers = buildStreamHeaders({
    fileRecord,
    start: 0,
    end: 999,
    isPartial: false,
    totalSize: 1000,
  });

  assert.equal(headers.get('Content-Type'), 'image/jpeg');
  assert.equal(headers.get('Content-Length'), '1000');
  assert.equal(headers.get('Accept-Ranges'), 'bytes');
  const disposition = headers.get('Content-Disposition');
  assert.ok(disposition.includes('%E6%B5%8B%E8%AF%95.jpg'));
  assert.ok(!headers.has('Content-Range'));
}

async function testBuildStreamHeadersForPartialContent() {
  const fileRecord = {
    mime_type: 'video/mp4',
    original_name: 'video.mp4',
  };

  const headers = buildStreamHeaders({
    fileRecord,
    start: 100,
    end: 199,
    isPartial: true,
    totalSize: 1000,
  });

  assert.equal(headers.get('Content-Type'), 'video/mp4');
  assert.equal(headers.get('Content-Length'), '100');
  assert.equal(headers.get('Content-Range'), 'bytes 100-199/1000');
  assert.equal(headers.get('Accept-Ranges'), 'bytes');
}

async function testBuildStreamHeadersWithMissingMimeType() {
  const fileRecord = {
    mime_type: null,
    original_name: 'file.bin',
  };

  const headers = buildStreamHeaders({
    fileRecord,
    start: 0,
    end: 99,
    isPartial: false,
    totalSize: 100,
  });

  assert.equal(headers.get('Content-Type'), 'application/octet-stream');
}

async function main() {
  await testResolveFileStorageWithInstanceId();
  await testResolveFileStorageWithLegacyTelegram();
  await testResolveFileStorageWithLegacyExternal();
  await testResolveFileStorageThrowsWhenMissing();
  await testParseRangeHeaderWithoutRange();
  await testParseRangeHeaderWithValidRange();
  await testParseRangeHeaderWithOpenEndRange();
  await testParseRangeHeaderWithInvalidRange();
  await testParseRangeHeaderClampsTotalSize();
  await testBuildStreamHeadersForFullContent();
  await testBuildStreamHeadersForPartialContent();
  await testBuildStreamHeadersWithMissingMimeType();
  console.log('view services tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
