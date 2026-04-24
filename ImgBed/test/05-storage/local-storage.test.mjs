import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import LocalStorage from '../../src/storage/local.js';
import {
  JSON_RESULT_TAG,
  parseJsonResult,
  runIsolatedModuleScript,
} from '../helpers/isolated-module-test-helpers.mjs';
import {
  cleanupPath,
  createTempAppRoot,
} from '../helpers/runtime-test-helpers.mjs';

function createStorageHarness(t) {
  const appRoot = createTempAppRoot('imgbed-local-storage-');
  const previousAppRoot = process.env.IMGBED_APP_ROOT;
  process.env.IMGBED_APP_ROOT = appRoot;

  t.after(() => {
    if (previousAppRoot === undefined) {
      delete process.env.IMGBED_APP_ROOT;
    } else {
      process.env.IMGBED_APP_ROOT = previousAppRoot;
    }

    cleanupPath(appRoot);
  });

  return {
    appRoot,
    basePath: path.join(appRoot, 'data', 'storage'),
    storage: new LocalStorage({ basePath: './data/storage' }),
  };
}

async function readStreamAsString(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

test('LocalStorage.put 会自动创建父目录并写入文件', { concurrency: false }, async (t) => {
  const harness = createStorageHarness(t);
  const fileId = 'abcd1234';

  const result = await harness.storage.put(Buffer.from('demo'), {
    id: fileId,
  });

  const filePath = path.join(harness.basePath, 'ab', fileId);
  assert.equal(result.storageKey, fileId);
  assert.equal(result.size, 4);
  assert.equal(result.deleteToken, null);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'demo');
});

test('LocalStorage.getStreamResponse 会返回正确的范围响应并在缺失时抛出文件不存在', { concurrency: false }, async (t) => {
  const harness = createStorageHarness(t);
  const fileId = 'beef5678';

  await harness.storage.put(Buffer.from('abcdef'), {
    id: fileId,
  });

  const readResult = await harness.storage.getStreamResponse(fileId, {
    start: 1,
    end: 3,
  });

  assert.equal(readResult.contentLength, 3);
  assert.equal(readResult.totalSize, 6);
  assert.equal(readResult.statusCode, 206);
  assert.equal(readResult.acceptRanges, true);
  assert.equal(await readStreamAsString(readResult.stream), 'bcd');

  await assert.rejects(
    () => harness.storage.getStreamResponse('miss1234'),
    /文件不存在: miss1234/,
  );
});

test('LocalStorage.delete 会删除已有文件并对缺失文件保持幂等成功', { concurrency: false }, async (t) => {
  const harness = createStorageHarness(t);
  const fileId = 'cafe9012';
  const filePath = path.join(harness.basePath, 'ca', fileId);

  await harness.storage.put(Buffer.from('to-delete'), {
    id: fileId,
  });

  assert.equal(await harness.storage.delete(fileId), true);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(await harness.storage.delete('gone5678'), true);
});

test('LocalStorage.exists 会正确返回文件存在性', { concurrency: false }, async (t) => {
  const harness = createStorageHarness(t);
  const fileId = 'deed3456';

  assert.equal(await harness.storage.exists(fileId), false);

  await harness.storage.put(Buffer.from('exists'), {
    id: fileId,
  });

  assert.equal(await harness.storage.exists(fileId), true);
});

test('LocalStorage.testConnection 会自动创建根目录并返回可写状态', { concurrency: false }, async (t) => {
  const harness = createStorageHarness(t);

  const result = await harness.storage.testConnection();

  assert.equal(result.ok, true);
  assert.match(result.message, /^目录可写:/);
  assert.equal(fs.existsSync(harness.basePath), true);
});

test('LocalStorage 关键路径不再依赖同步 fs API', { concurrency: false }, () => {
  const execution = runIsolatedModuleScript(`
    import fs from 'node:fs';
    import LocalStorage from './src/storage/local.js';

    const originalExistsSync = fs.existsSync;
    const originalMkdirSync = fs.mkdirSync;

    try {
      fs.existsSync = () => {
        throw new Error('existsSync 不应被调用');
      };
      fs.mkdirSync = () => {
        throw new Error('mkdirSync 不应被调用');
      };

      const storage = new LocalStorage({ basePath: './data/storage' });
      const connection = await storage.testConnection();
      const putResult = await storage.put(Buffer.from('demo'), { id: 'face1234' });
      const existsBeforeDelete = await storage.exists('face1234');
      const readResult = await storage.getStreamResponse('face1234');
      const bodyChunks = [];

      for await (const chunk of readResult.stream) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const deleteResult = await storage.delete('face1234');
      const existsAfterDelete = await storage.exists('face1234');

      console.log('${JSON_RESULT_TAG}' + JSON.stringify({
        connection,
        putResult,
        existsBeforeDelete,
        body: Buffer.concat(bodyChunks).toString('utf8'),
        deleteResult,
        existsAfterDelete,
        basePathExists: originalExistsSync(storage.basePath),
      }));
    } finally {
      fs.existsSync = originalExistsSync;
      fs.mkdirSync = originalMkdirSync;
    }
  `, {
    appRootPrefix: 'imgbed-local-storage-sync-guard-',
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);

  const result = parseJsonResult(execution);
  assert.equal(result.connection.ok, true);
  assert.equal(result.putResult.storageKey, 'face1234');
  assert.equal(result.existsBeforeDelete, true);
  assert.equal(result.body, 'demo');
  assert.equal(result.deleteResult, true);
  assert.equal(result.existsAfterDelete, false);
  assert.equal(result.basePathExists, true);
});
