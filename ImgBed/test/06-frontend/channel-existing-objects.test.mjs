import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatObjectSize,
  formatObjectTime,
  summarizeExistingObjects,
} from '../../../ImgBed-web/src/components/common/channelExistingObjects.js';

test('summarizeExistingObjects 会生成折叠明细需要的展示摘要', () => {
  assert.deepEqual(summarizeExistingObjects({
    isTruncated: true,
    items: [{ key: 'images/demo.png' }, { key: 'images/banner.png' }],
  }), {
    hasItems: true,
    countLabel: '2 条',
    truncatedLabel: '仅显示部分',
  });
});

test('formatObjectSize 会按对象大小生成紧凑文案', () => {
  assert.equal(formatObjectSize(512), '512 B');
  assert.equal(formatObjectSize(1536), '1.5 KB');
  assert.equal(formatObjectSize(2 * 1024 * 1024), '2.0 MB');
});

test('formatObjectTime 会处理空值与非法时间', () => {
  assert.equal(formatObjectTime(null), '未知时间');
  assert.equal(formatObjectTime('not-a-date'), '未知时间');
});
