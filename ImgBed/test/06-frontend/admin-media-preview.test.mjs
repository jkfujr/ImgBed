import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminMediaSrc,
  buildFileViewPath,
  shouldUseVideoFallback,
} from '../../../ImgBed-web/src/admin/mediaPreviewShared.js';

test('shouldUseVideoFallback 会对 GIF 元数据启用视频回退', () => {
  assert.equal(shouldUseVideoFallback({
    mime_type: 'image/gif',
    original_name: 'demo.gif',
  }), true);

  assert.equal(shouldUseVideoFallback({
    mime_type: '',
    original_name: 'demo.gif',
  }), true);

  assert.equal(shouldUseVideoFallback({
    mime_type: 'image/jpeg',
    original_name: 'demo.jpg',
    file_name: 'demo.jpg',
  }), false);
});

test('buildAdminMediaSrc 会按文件 id 生成管理页预览地址', () => {
  assert.equal(buildAdminMediaSrc({ id: 'file-1.png' }), '/file-1.png');
  assert.equal(buildAdminMediaSrc(null), '');
});

test('buildFileViewPath 会对中文文件 id 进行路径编码', () => {
  const fileId = '9175fa2e42c4_截图_2026_04_23.png';
  const encodedPath = '/9175fa2e42c4_%E6%88%AA%E5%9B%BE_2026_04_23.png';

  assert.equal(buildFileViewPath(fileId), encodedPath);
  assert.equal(buildAdminMediaSrc({ id: fileId }), encodedPath);
});
