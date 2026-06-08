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
      thresholdReached: false,
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
      thresholdReached: false,
      color: 'primary',
      text: '1.00 GB / 2 GB',
    },
  );
});

test('buildStorageUsageDisplay 会标记达到停用阈值的容量状态', () => {
  assert.deepEqual(
    buildStorageUsageDisplay({
      usedBytes: 95 * 1024 ** 3,
      quotaLimitGB: 100,
      disableThresholdPercent: 95,
    }),
    {
      limited: true,
      percent: 95,
      thresholdReached: true,
      color: 'error',
      text: '95.00 GB / 100 GB',
    },
  );
});

test('getStorageUsageColor 会在达到停用阈值时返回错误色', () => {
  assert.equal(getStorageUsageColor(95, 95), 'error');
  assert.equal(getStorageUsageColor(80, 95), 'warning');
});
