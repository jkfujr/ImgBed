const SENSITIVE_CONFIG_REVEAL_PURPOSE = 'sensitive_config_reveal';
const SENSITIVE_CONFIG_REVEAL_EXPIRES_IN = '10m';

function createSensitiveConfigRevealPayload(username) {
  return {
    role: 'admin',
    username,
    purpose: SENSITIVE_CONFIG_REVEAL_PURPOSE,
    reauthAt: Date.now(),
  };
}

function isSensitiveConfigRevealPayload(payload) {
  return payload?.role === 'admin' && payload?.purpose === SENSITIVE_CONFIG_REVEAL_PURPOSE;
}

export {
  SENSITIVE_CONFIG_REVEAL_EXPIRES_IN,
  SENSITIVE_CONFIG_REVEAL_PURPOSE,
  createSensitiveConfigRevealPayload,
  isSensitiveConfigRevealPayload,
};
