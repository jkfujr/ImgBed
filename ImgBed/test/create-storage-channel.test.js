const assert = require('node:assert/strict');
const { buildNewStorageChannel, validateStorageChannelInput } = require('../src/services/system/create-storage-channel');

function testValidateStorageChannelInputSuccess() {
  const body = {
    id: 'test-storage',
    type: 's3',
    name: 'Test Storage',
  };
  const validTypes = ['local', 's3', 'telegram', 'discord'];

  const error = validateStorageChannelInput(body, validTypes);

  assert.equal(error, null);
}

function testValidateStorageChannelInputInvalidId() {
  const body = {
    id: 'invalid id!',
    type: 's3',
    name: 'Test',
  };
  const validTypes = ['s3'];

  const error = validateStorageChannelInput(body, validTypes);

  assert.notEqual(error, null);
  assert.equal(error.code, 400);
  assert.ok(error.message.includes('id 不合法'));
}

function testValidateStorageChannelInputInvalidType() {
  const body = {
    id: 'test',
    type: 'invalid-type',
    name: 'Test',
  };
  const validTypes = ['s3', 'local'];

  const error = validateStorageChannelInput(body, validTypes);

  assert.notEqual(error, null);
  assert.equal(error.code, 400);
  assert.ok(error.message.includes('type 不合法'));
}

function testValidateStorageChannelInputEmptyName() {
  const body = {
    id: 'test',
    type: 's3',
    name: '   ',
  };
  const validTypes = ['s3'];

  const error = validateStorageChannelInput(body, validTypes);

  assert.notEqual(error, null);
  assert.equal(error.code, 400);
  assert.ok(error.message.includes('name 不能为空'));
}

function testBuildNewStorageChannelWithQuota() {
  const body = {
    id: 'test-s3',
    type: 's3',
    name: 'Test S3',
    enabled: true,
    allowUpload: true,
    weight: 2,
    enableQuota: true,
    quotaLimitGB: 50,
    disableThresholdPercent: 90,
    enableSizeLimit: true,
    sizeLimitMB: 20,
    enableChunking: true,
    chunkSizeMB: 10,
    maxChunks: 100,
    enableMaxLimit: true,
    maxLimitMB: 200,
    config: { bucket: 'test-bucket', pathStyle: 'true' },
  };

  const result = buildNewStorageChannel(body);

  assert.equal(result.id, 'test-s3');
  assert.equal(result.type, 's3');
  assert.equal(result.name, 'Test S3');
  assert.equal(result.enabled, true);
  assert.equal(result.allowUpload, true);
  assert.equal(result.weight, 2);
  assert.equal(result.quotaLimitGB, 50);
  assert.equal(result.disableThresholdPercent, 90);
  assert.equal(result.enableSizeLimit, true);
  assert.equal(result.sizeLimitMB, 20);
  assert.equal(result.enableChunking, true);
  assert.equal(result.chunkSizeMB, 10);
  assert.equal(result.maxChunks, 100);
  assert.equal(result.enableMaxLimit, true);
  assert.equal(result.maxLimitMB, 200);
  assert.deepEqual(result.config, { bucket: 'test-bucket', pathStyle: true });
}

function testBuildNewStorageChannelWithoutQuota() {
  const body = {
    id: 'test-local',
    type: 'local',
    name: 'Test Local',
    enableQuota: false,
  };

  const result = buildNewStorageChannel(body);

  assert.equal(result.id, 'test-local');
  assert.equal(result.quotaLimitGB, null);
  assert.equal(result.disableThresholdPercent, 95);
}

function testBuildNewStorageChannelDefaults() {
  const body = {
    id: 'minimal',
    type: 'local',
    name: 'Minimal',
  };

  const result = buildNewStorageChannel(body);

  assert.equal(result.enabled, true);
  assert.equal(result.allowUpload, false);
  assert.equal(result.weight, 1);
  assert.equal(result.sizeLimitMB, 10);
  assert.equal(result.chunkSizeMB, 5);
  assert.equal(result.maxChunks, 0);
  assert.equal(result.maxLimitMB, 100);
}

async function main() {
  testValidateStorageChannelInputSuccess();
  testValidateStorageChannelInputInvalidId();
  testValidateStorageChannelInputInvalidType();
  testValidateStorageChannelInputEmptyName();
  testBuildNewStorageChannelWithQuota();
  testBuildNewStorageChannelWithoutQuota();
  testBuildNewStorageChannelDefaults();
  console.log('create-storage-channel tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
