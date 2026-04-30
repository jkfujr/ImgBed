import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUtcDatabaseDate } from '../../../ImgBed-web/src/utils/formatters.js';

test('normalizeUtcDatabaseDate 会将 SQLite UTC 时间标记为 UTC', () => {
  assert.equal(
    normalizeUtcDatabaseDate('2026-04-30 04:18:20'),
    '2026-04-30T04:18:20Z',
  );
});

test('normalizeUtcDatabaseDate 不会改写已经包含时区的时间', () => {
  assert.equal(
    normalizeUtcDatabaseDate('2026-04-30T04:18:20+08:00'),
    '2026-04-30T04:18:20+08:00',
  );
  assert.equal(
    normalizeUtcDatabaseDate('2026-04-30T04:18:20Z'),
    '2026-04-30T04:18:20Z',
  );
});
