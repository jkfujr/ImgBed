const assert = require('node:assert/strict');
const { handleChunkedStream, handleRegularStream } = require('../src/services/view/handle-stream');

function createMockStorageManager(storages = {}) {
  return {
    getStorage(id) {
      return storages[id] || null;
    },
  };
}

function createMockStorage() {
  return {
    async getStream(key, options) {
      return {
        pipe: () => {},
        on: () => {},
      };
    },
  };
}

async function testHandleChunkedStreamThrowsWhenNoChunks() {
  const fileRecord = {
    id: 'file-1',
    size: 1000,
    mime_type: 'image/jpeg',
    original_name: 'test.jpg',
    is_chunked: true,
  };

  const storageManager = createMockStorageManager();

  // Mock ChunkManager.getChunks to return empty
  const ChunkManager = require('../src/storage/chunk-manager');
  const originalGetChunks = ChunkManager.getChunks;
  ChunkManager.getChunks = async () => [];

  try {
    await handleChunkedStream(fileRecord, {
      start: 0,
      end: 999,
      isPartial: false,
      storageManager,
    });
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 500);
    assert.ok(err.message.includes('分块记录缺失'));
  } finally {
    ChunkManager.getChunks = originalGetChunks;
  }
}

async function testHandleRegularStreamThrowsWhenStreamFails() {
  const fileRecord = {
    id: 'file-1',
    size: 1000,
    mime_type: 'image/jpeg',
    original_name: 'test.jpg',
    is_chunked: false,
  };

  const storage = {
    async getStream() {
      throw new Error('Storage error');
    },
  };

  // 临时捕获 console.error 输出，避免测试输出中出现错误日志
  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    await handleRegularStream(fileRecord, storage, 'test-key', {
      start: 0,
      end: 999,
      isPartial: false,
    });
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 502);
    assert.ok(err.message.includes('向原点提取文件内容失败'));
    // 验证错误日志被正确记录
    assert.ok(errorLogs.length > 0);
    assert.ok(errorLogs[0].some(arg => typeof arg === 'string' && arg.includes('[View API]')));
  } finally {
    console.error = originalConsoleError;
  }
}

async function testHandleRegularStreamSuccess() {
  const fileRecord = {
    id: 'file-1',
    size: 1000,
    mime_type: 'image/jpeg',
    original_name: 'test.jpg',
    is_chunked: false,
  };

  const storage = createMockStorage();

  const response = await handleRegularStream(fileRecord, storage, 'test-key', {
    start: 0,
    end: 999,
    isPartial: false,
  });

  assert.equal(response.status, 200);
  assert.ok(response.headers);
}

async function testHandleRegularStreamPartial() {
  const fileRecord = {
    id: 'file-1',
    size: 1000,
    mime_type: 'image/jpeg',
    original_name: 'test.jpg',
    is_chunked: false,
  };

  const storage = createMockStorage();

  const response = await handleRegularStream(fileRecord, storage, 'test-key', {
    start: 0,
    end: 499,
    isPartial: true,
  });

  assert.equal(response.status, 206);
  assert.ok(response.headers);
}

async function main() {
  await testHandleChunkedStreamThrowsWhenNoChunks();
  await testHandleRegularStreamThrowsWhenStreamFails();
  await testHandleRegularStreamSuccess();
  await testHandleRegularStreamPartial();
  console.log('view stream handling tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
