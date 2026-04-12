import { AUTH_REASON_SESSION_INVALID } from './session.js';

export const AUTH_PROBE_ACTION_IGNORE = 'ignore';
export const AUTH_PROBE_ACTION_INVALIDATE = 'invalidate';
export const AUTH_PROBE_ACTION_KEEP = 'keep';

export function getBootstrapAuthState(token) {
  return {
    isAuthenticated: Boolean(token),
    loading: false,
  };
}

export function resolveAuthProbeFailureAction({
  payloadReason,
  requestToken,
  activeToken,
  requestVersion,
  activeVersion,
}) {
  if (requestVersion !== activeVersion || requestToken !== activeToken) {
    return AUTH_PROBE_ACTION_IGNORE;
  }

  if (
    payloadReason === AUTH_REASON_SESSION_INVALID &&
    requestToken &&
    activeToken &&
    requestToken === activeToken
  ) {
    return AUTH_PROBE_ACTION_INVALIDATE;
  }

  return AUTH_PROBE_ACTION_KEEP;
}
