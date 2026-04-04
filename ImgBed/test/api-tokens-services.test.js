const assert = require('node:assert/strict');
const { validateTokenInput, createTokenRecord } = require('../src/services/api-tokens/create-token');

async function testValidateTokenInputSuccess() {
  const body = {
    name: 'Test Token',
    permissions: ['upload:image', 'files:read'],
    expiresMode: 'never',
  };

  const result = validateTokenInput(body);
  assert.equal(result.name, 'Test Token');
  assert.deepEqual(result.permissions, ['upload:image', 'files:read']);
  assert.equal(result.expiresAt, null);
}

async function testValidateTokenInputWithCustomExpiry() {
  const futureDate = new Date(Date.now() + 86400000); // 明天
  const body = {
    name: 'Test Token',
    permissions: ['upload:image'],
    expiresMode: 'custom',
    expiresAt: futureDate,
  };

  const result = validateTokenInput(body);
  assert.equal(result.name, 'Test Token');
  assert.equal(result.expiresAt, futureDate.toISOString());
}

async function testValidateTokenInputThrowsOnEmptyName() {
  const body = {
    name: '',
    permissions: ['upload:image'],
  };

  try {
    validateTokenInput(body);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.ok(err.message.includes('名称不能为空'));
  }
}

async function testValidateTokenInputThrowsOnEmptyPermissions() {
  const body = {
    name: 'Test Token',
    permissions: [],
  };

  try {
    validateTokenInput(body);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.ok(err.message.includes('至少选择一项权限'));
  }
}

async function testValidateTokenInputThrowsOnInvalidPermissions() {
  const body = {
    name: 'Test Token',
    permissions: ['invalid:permission'],
  };

  try {
    validateTokenInput(body);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.ok(err.message.includes('权限配置无效'));
  }
}

async function testValidateTokenInputThrowsOnInvalidExpiryDate() {
  const body = {
    name: 'Test Token',
    permissions: ['upload:image'],
    expiresMode: 'custom',
    expiresAt: 'invalid-date',
  };

  try {
    validateTokenInput(body);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.ok(err.message.includes('过期时间格式无效'));
  }
}

async function testValidateTokenInputThrowsOnPastExpiryDate() {
  const pastDate = new Date(Date.now() - 86400000); // 昨天
  const body = {
    name: 'Test Token',
    permissions: ['upload:image'],
    expiresMode: 'custom',
    expiresAt: pastDate,
  };

  try {
    validateTokenInput(body);
    assert.fail('应该抛出错误');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.ok(err.message.includes('过期时间必须晚于当前时间'));
  }
}

async function testCreateTokenRecord() {
  const validated = {
    name: 'Test Token',
    permissions: ['upload:image', 'files:read'],
    expiresAt: '2026-12-31T23:59:59.000Z',
  };

  const mockGenerateTokenId = () => 'test-id-123';
  const record = createTokenRecord(
    validated,
    'plain-token-abc',
    'prefix-xyz',
    'hash-def',
    mockGenerateTokenId
  );

  assert.equal(record.id, 'test-id-123');
  assert.equal(record.name, 'Test Token');
  assert.equal(record.token_prefix, 'prefix-xyz');
  assert.equal(record.token_hash, 'hash-def');
  assert.equal(record.permissions, '["upload:image","files:read"]');
  assert.equal(record.status, 'active');
  assert.equal(record.expires_at, '2026-12-31T23:59:59.000Z');
  assert.equal(record.created_by, 'admin');
}

async function testCreateTokenRecordWithNullExpiry() {
  const validated = {
    name: 'Test Token',
    permissions: ['upload:image'],
    expiresAt: null,
  };

  const mockGenerateTokenId = () => 'test-id-456';
  const record = createTokenRecord(
    validated,
    'plain-token-abc',
    'prefix-xyz',
    'hash-def',
    mockGenerateTokenId
  );

  assert.equal(record.expires_at, null);
}

async function main() {
  await testValidateTokenInputSuccess();
  await testValidateTokenInputWithCustomExpiry();
  await testValidateTokenInputThrowsOnEmptyName();
  await testValidateTokenInputThrowsOnEmptyPermissions();
  await testValidateTokenInputThrowsOnInvalidPermissions();
  await testValidateTokenInputThrowsOnInvalidExpiryDate();
  await testValidateTokenInputThrowsOnPastExpiryDate();
  await testCreateTokenRecord();
  await testCreateTokenRecordWithNullExpiry();
  console.log('api-tokens services tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
