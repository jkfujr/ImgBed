import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const configIoModule = await import('../ImgBed/src/services/system/config-io.js');

assert.deepEqual(
  Object.keys(configIoModule).sort(),
  ['readSystemConfig', 'syncAllowedUploadChannels', 'writeSystemConfig'],
  'config-io 应只保留最小运行配置接口',
);

const configIoSource = fs.readFileSync(
  path.resolve('ImgBed/src/services/system/config-io.js'),
  'utf8',
);
assert.ok(!configIoSource.includes('getSystemConfigPath'));
assert.ok(!configIoSource.includes('_configPath'));

const systemRouteSource = fs.readFileSync(
  path.resolve('ImgBed/src/routes/system.js'),
  'utf8',
);
assert.ok(!systemRouteSource.includes('readSystemConfig(configPath)'));
assert.ok(!systemRouteSource.includes('writeSystemConfig(configPath'));
assert.ok(
  systemRouteSource.includes("cfg.storage.storages = (cfg.storage.storages || []).filter((entry) => entry.id !== id);"),
  '删除渠道后应从配置文件移除，而不是继续保留禁用壳',
);

const publicRouteSource = fs.readFileSync(
  path.resolve('ImgBed/src/routes/public.js'),
  'utf8',
);
assert.ok(!publicRouteSource.includes('getSystemConfigPath'));

const guestUploadSource = fs.readFileSync(
  path.resolve('ImgBed/src/middleware/guestUpload.js'),
  'utf8',
);
assert.ok(!guestUploadSource.includes('getSystemConfigPath'));
