import { strict as assert } from 'node:assert';

import {
  getLastKnownGoodConfig,
  loadStartupConfig,
  readRuntimeConfig,
} from '../ImgBed/src/config/index.js';
import { sanitizeSystemConfig } from '../ImgBed/src/services/system/sanitize-system-config.js';
import { signToken, verifyToken } from '../ImgBed/src/utils/jwt.js';

async function testSanitizeSystemConfigDoesNotMutateJwtSecret() {
  loadStartupConfig();
  const runtimeConfig = readRuntimeConfig();
  const originalSecret = getLastKnownGoodConfig().jwt.secret;
  const token = await signToken({
    role: 'admin',
    username: 'admin',
  });

  const sanitized = sanitizeSystemConfig(runtimeConfig);

  assert.equal(sanitized.jwt.secret, '******');
  assert.equal(getLastKnownGoodConfig().jwt.secret, originalSecret);

  const verified = await verifyToken(token);
  assert.equal(verified.ok, true);
  console.log('  [OK] system-config-sanitization: sanitizing config does not mutate jwt secret');
}

async function main() {
  console.log('running system-config-sanitization tests...');
  await testSanitizeSystemConfigDoesNotMutateJwtSecret();
  console.log('system-config-sanitization tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
