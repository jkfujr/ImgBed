import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStorageUsageDisplay,
  getStorageUsageColor,
} from '../../../ImgBed-web/src/components/common/storageUsage.js';

test('buildStorageUsageDisplay 会在无限容量时显示已用大小', () => {
  assert.deepEqual(
    buildStorageUsageDisplay({
      usedBytes: 1024 ** 3,
      quotaLimitGB: null,
    }),
    {
      limited: false,
      text: '1.00 GB / 无限制',
    },
  );
});

test('buildStorageUsageDisplay 会在有限容量时显示百分比和容量上限', () => {
  assert.deepEqual(
    buildStorageUsageDisplay({
      usedBytes: 1024 ** 3,
      quotaLimitGB: 2,
    }),
    {
      limited: true,
      percent: 50,
      color: 'primary',
      text: '1.00 GB / 2 GB',
    },
  );
});

test('getStorageUsageColor 会在达到停用阈值时返回错误色', () => {
  assert.equal(getStorageUsageColor(95, 95), 'error');
  assert.equal(getStorageUsageColor(80, 95), 'warning');
});
