import { strict as assert } from 'node:assert';

import { createRequestGuard } from '../ImgBed-web/src/utils/request-guard.js';

function testLatestRequestWins() {
  const guard = createRequestGuard();
  const first = guard.begin();
  const second = guard.begin();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  console.log('  [OK] frontend-admin-request-race: newer request invalidates older response');
}

function testDisposedGuardRejectsLateResponse() {
  const guard = createRequestGuard();
  const requestId = guard.begin();

  guard.dispose();

  assert.equal(guard.isCurrent(requestId), false);
  console.log('  [OK] frontend-admin-request-race: disposed page ignores late response');
}

function testGuardCanBeReusedAfterStrictModeCleanupCycle() {
  const guard = createRequestGuard();
  const firstRequest = guard.begin();

  guard.dispose();

  const secondRequest = guard.begin();

  assert.equal(guard.isCurrent(firstRequest), false);
  assert.equal(
    guard.isCurrent(secondRequest),
    true,
    'guard should accept a new current request after a cleanup/restart cycle',
  );
  console.log('  [OK] frontend-admin-request-race: guard survives strict-mode cleanup cycle');
}

function main() {
  console.log('running frontend-admin-request-race tests...');
  testLatestRequestWins();
  testDisposedGuardRejectsLateResponse();
  testGuardCanBeReusedAfterStrictModeCleanupCycle();
  console.log('frontend-admin-request-race tests passed');
}

main();
