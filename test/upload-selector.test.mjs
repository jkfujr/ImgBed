import { strict as assert } from 'node:assert';

import { UploadSelector } from '../ImgBed/src/storage/runtime/upload-selector.js';

function makeSelector({
  config = {},
  defaultId = null,
  entries = new Map(),
  allowedIds = new Set(),
  usageStats = new Map(),
  random = () => 0,
} = {}) {
  return new UploadSelector({
    logger: { warn() {}, info() {}, error() {} },
    getConfig: () => config,
    getDefaultStorageId: () => defaultId,
    listStorageEntries: () => Array.from(entries.entries()),
    isUploadAllowed: (id) => allowedIds.has(id),
    getUsageStats: () => usageStats,
    random,
  });
}

function testDefaultStrategyPrefersDefaultChannel() {
  const entries = new Map([
    ['local-1', { type: 'local', weight: 1 }],
    ['s3-1', { type: 's3', weight: 1 }],
  ]);

  const selector = makeSelector({
    config: { loadBalanceStrategy: 'default' },
    defaultId: 's3-1',
    entries,
    allowedIds: new Set(['local-1', 's3-1']),
  });

  assert.equal(selector.selectUploadChannel(), 's3-1');
  assert.equal(selector.selectUploadChannel(null, ['s3-1']), 'local-1');
  console.log('  [OK] upload-selector: default strategy prefers the configured default and respects exclusions');
}

function testRoundRobinCyclesAllowedChannels() {
  const entries = new Map([
    ['a', { type: 'local', weight: 1 }],
    ['b', { type: 's3', weight: 1 }],
  ]);

  const selector = makeSelector({
    config: { loadBalanceStrategy: 'round-robin' },
    entries,
    allowedIds: new Set(['a', 'b']),
  });

  assert.equal(selector.selectUploadChannel(), 'a');
  assert.equal(selector.selectUploadChannel(), 'b');
  assert.equal(selector.selectUploadChannel(), 'a');
  console.log('  [OK] upload-selector: round-robin keeps its own cursor state');
}

function testLeastUsedChoosesSmallestFileCount() {
  const entries = new Map([
    ['busy', { type: 'local', weight: 1 }],
    ['free', { type: 's3', weight: 1 }],
  ]);

  const selector = makeSelector({
    config: { loadBalanceStrategy: 'least-used' },
    entries,
    allowedIds: new Set(['busy', 'free']),
    usageStats: new Map([
      ['busy', { uploadCount: 10, fileCount: 8 }],
      ['free', { uploadCount: 2, fileCount: 1 }],
    ]),
  });

  assert.equal(selector.selectUploadChannel(), 'free');
  console.log('  [OK] upload-selector: least-used uses usage stats instead of declaration order');
}

function testWeightedUsesInjectedRandomAndConfigWeights() {
  const entries = new Map([
    ['a', { type: 'local', weight: 1 }],
    ['b', { type: 's3', weight: 1 }],
  ]);

  const selector = makeSelector({
    config: {
      loadBalanceStrategy: 'weighted',
      loadBalanceWeights: { a: 1, b: 3 },
    },
    entries,
    allowedIds: new Set(['a', 'b']),
    random: () => 0.9,
  });

  assert.equal(selector.selectUploadChannel(), 'b');
  console.log('  [OK] upload-selector: weighted strategy uses injected random and configured weights');
}

function testByTypeScopeFiltersCandidates() {
  const entries = new Map([
    ['local-1', { type: 'local', weight: 1 }],
    ['s3-1', { type: 's3', weight: 1 }],
    ['s3-2', { type: 's3', weight: 1 }],
  ]);

  const selector = makeSelector({
    config: {
      loadBalanceStrategy: 'random',
      loadBalanceScope: 'byType',
      loadBalanceEnabledTypes: ['s3'],
    },
    entries,
    allowedIds: new Set(['local-1', 's3-1', 's3-2']),
    random: () => 0,
  });

  assert.equal(selector.selectUploadChannel('s3'), 's3-1');
  assert.equal(selector.selectUploadChannel('local'), null);
  console.log('  [OK] upload-selector: byType scope only keeps enabled preferred types');
}

function main() {
  console.log('running upload-selector tests...');
  testDefaultStrategyPrefersDefaultChannel();
  testRoundRobinCyclesAllowedChannels();
  testLeastUsedChoosesSmallestFileCount();
  testWeightedUsesInjectedRandomAndConfigWeights();
  testByTypeScopeFiltersCandidates();
  console.log('upload-selector tests passed');
}

main();
