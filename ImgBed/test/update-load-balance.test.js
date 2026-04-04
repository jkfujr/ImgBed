const assert = require('node:assert/strict');
const { updateLoadBalanceConfig, VALID_STRATEGIES } = require('../src/services/system/update-load-balance');

function testUpdateLoadBalanceConfigSuccess() {
  const cfg = { storage: {} };
  const body = {
    strategy: 'round-robin',
    scope: 'all',
    enabledTypes: ['s3', 'local'],
    weights: { s3: 2, local: 1 },
    failoverEnabled: true,
  };

  const error = updateLoadBalanceConfig(cfg, body);

  assert.equal(error, null);
  assert.equal(cfg.storage.loadBalanceStrategy, 'round-robin');
  assert.equal(cfg.storage.loadBalanceScope, 'all');
  assert.deepEqual(cfg.storage.loadBalanceEnabledTypes, ['s3', 'local']);
  assert.deepEqual(cfg.storage.loadBalanceWeights, { s3: 2, local: 1 });
  assert.equal(cfg.storage.failoverEnabled, true);
}

function testUpdateLoadBalanceConfigInvalidStrategy() {
  const cfg = { storage: {} };
  const body = { strategy: 'invalid-strategy' };

  const error = updateLoadBalanceConfig(cfg, body);

  assert.notEqual(error, null);
  assert.equal(error.code, 400);
  assert.ok(error.message.includes('无效的策略'));
}

function testUpdateLoadBalanceConfigPartialUpdate() {
  const cfg = { storage: { loadBalanceStrategy: 'default' } };
  const body = { failoverEnabled: false };

  const error = updateLoadBalanceConfig(cfg, body);

  assert.equal(error, null);
  assert.equal(cfg.storage.loadBalanceStrategy, 'default');
  assert.equal(cfg.storage.failoverEnabled, false);
}

function testUpdateLoadBalanceConfigInitStorage() {
  const cfg = {};
  const body = { strategy: 'random' };

  const error = updateLoadBalanceConfig(cfg, body);

  assert.equal(error, null);
  assert.ok(cfg.storage);
  assert.equal(cfg.storage.loadBalanceStrategy, 'random');
}

async function main() {
  testUpdateLoadBalanceConfigSuccess();
  testUpdateLoadBalanceConfigInvalidStrategy();
  testUpdateLoadBalanceConfigPartialUpdate();
  testUpdateLoadBalanceConfigInitStorage();
  console.log('update-load-balance tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
