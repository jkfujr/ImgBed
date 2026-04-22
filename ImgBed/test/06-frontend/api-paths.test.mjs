import assert from 'node:assert/strict';
import test from 'node:test';

import {
  api,
  buildFileApiPath,
  FileDocs,
} from '../../../ImgBed-web/src/api.js';

test('buildFileApiPath 会对中文文件 id 进行路径编码', () => {
  assert.equal(
    buildFileApiPath('9175fa2e42c4_截图_2026_04_23.png'),
    '/api/files/9175fa2e42c4_%E6%88%AA%E5%9B%BE_2026_04_23.png',
  );
});

test('FileDocs.update 与 FileDocs.delete 会使用编码后的文件路径', async () => {
  const calls = [];
  const originalPut = api.put;
  const originalDelete = api.delete;
  const fileId = '9175fa2e42c4_截图_2026_04_23.png';

  api.put = async (url, payload) => {
    calls.push({ method: 'put', url, payload });
    return { code: 0 };
  };
  api.delete = async (url, options) => {
    calls.push({ method: 'delete', url, options });
    return { code: 0 };
  };

  try {
    await FileDocs.update(fileId, { file_name: 'renamed.png' });
    await FileDocs.delete(fileId, 'index');
  } finally {
    api.put = originalPut;
    api.delete = originalDelete;
  }

  assert.deepEqual(calls, [
    {
      method: 'put',
      url: '/api/files/9175fa2e42c4_%E6%88%AA%E5%9B%BE_2026_04_23.png',
      payload: { file_name: 'renamed.png' },
    },
    {
      method: 'delete',
      url: '/api/files/9175fa2e42c4_%E6%88%AA%E5%9B%BE_2026_04_23.png',
      options: {
        params: { delete_mode: 'index' },
      },
    },
  ]);
});
