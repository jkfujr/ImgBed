import { strict as assert } from 'node:assert';

import { classifyJwtVerificationError } from '../ImgBed/src/utils/jwt.js';

function testSignatureFailureIsTreatedAsExpectedAuthFailure() {
  const result = classifyJwtVerificationError({
    name: 'JWSSignatureVerificationFailed',
    code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    message: 'signature verification failed',
  });

  assert.equal(result.level, 'info');
  assert.equal(result.message, 'Token 验签失败，需重新登录');
  assert.deepEqual(result.context, {
    code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    name: 'JWSSignatureVerificationFailed',
  });
  console.log('  [OK] jwt: signature failure is classified as expected auth failure');
}

function testExpiredTokenIsTreatedAsExpectedAuthFailure() {
  const result = classifyJwtVerificationError({
    name: 'JWTExpired',
    code: 'ERR_JWT_EXPIRED',
    message: '"exp" claim timestamp check failed',
  });

  assert.equal(result.level, 'info');
  assert.equal(result.message, 'Token 已过期，需重新登录');
  assert.deepEqual(result.context, {
    code: 'ERR_JWT_EXPIRED',
    name: 'JWTExpired',
  });
  console.log('  [OK] jwt: expired token is classified as expected auth failure');
}

function testUnexpectedJwtErrorRemainsSystemError() {
  const error = new Error('crypto backend unavailable');
  const result = classifyJwtVerificationError(error);

  assert.equal(result.level, 'error');
  assert.equal(result.message, 'Token 解析失败');
  assert.deepEqual(result.context, { err: error });
  console.log('  [OK] jwt: unexpected verification errors remain system errors');
}

function main() {
  console.log('running jwt-verification-classification tests...');
  testSignatureFailureIsTreatedAsExpectedAuthFailure();
  testExpiredTokenIsTreatedAsExpectedAuthFailure();
  testUnexpectedJwtErrorRemainsSystemError();
  console.log('jwt-verification-classification tests passed');
}

main();
