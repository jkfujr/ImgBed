import { strict as assert } from 'node:assert';

import {
  AUTH_PROBE_ACTION_IGNORE,
  AUTH_PROBE_ACTION_INVALIDATE,
  AUTH_PROBE_ACTION_KEEP,
  getBootstrapAuthState,
  resolveAuthProbeFailureAction,
} from '../ImgBed-web/src/auth/auth-session-state.js';

function testBootstrapStateKeepsSessionWhenTokenExists() {
  const state = getBootstrapAuthState('active-token');

  assert.deepEqual(state, {
    isAuthenticated: true,
    loading: false,
  });
  console.log('  [OK] frontend-auth-provider: bootstrap state keeps session when token exists');
}

function testProbeFailureKeepsCurrentSessionForNonInvalidReasons() {
  const action = resolveAuthProbeFailureAction({
    payloadReason: 'AUTH_MISSING',
    requestToken: 'active-token',
    activeToken: 'active-token',
    requestVersion: 1,
    activeVersion: 1,
  });

  assert.equal(action, AUTH_PROBE_ACTION_KEEP);
  console.log('  [OK] frontend-auth-provider: AUTH_MISSING does not invalidate current session');
}

function testProbeFailureIgnoresStaleSessionInvalidResponse() {
  const action = resolveAuthProbeFailureAction({
    payloadReason: 'AUTH_SESSION_INVALID',
    requestToken: 'stale-token',
    activeToken: 'new-token',
    requestVersion: 1,
    activeVersion: 2,
  });

  assert.equal(action, AUTH_PROBE_ACTION_IGNORE);
  console.log('  [OK] frontend-auth-provider: stale AUTH_SESSION_INVALID is ignored');
}

function testProbeFailureInvalidatesOnlyCurrentSessionInvalidResponse() {
  const action = resolveAuthProbeFailureAction({
    payloadReason: 'AUTH_SESSION_INVALID',
    requestToken: 'active-token',
    activeToken: 'active-token',
    requestVersion: 3,
    activeVersion: 3,
  });

  assert.equal(action, AUTH_PROBE_ACTION_INVALIDATE);
  console.log('  [OK] frontend-auth-provider: current AUTH_SESSION_INVALID invalidates session');
}

function main() {
  console.log('running frontend-auth-provider tests...');
  testBootstrapStateKeepsSessionWhenTokenExists();
  testProbeFailureKeepsCurrentSessionForNonInvalidReasons();
  testProbeFailureIgnoresStaleSessionInvalidResponse();
  testProbeFailureInvalidatesOnlyCurrentSessionInvalidResponse();
  console.log('frontend-auth-provider tests passed');
}

main();
