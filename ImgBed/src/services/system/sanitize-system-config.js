const STORAGE_MASK_VALUE = '***';
const STORAGE_SENSITIVE_KEYS = ['secretAccessKey', 'botToken', 'token', 'webhookUrl', 'authHeader', 'password'];

function isStorageSensitiveKey(key, sensitiveKeys = STORAGE_SENSITIVE_KEYS) {
  return sensitiveKeys.includes(key);
}

function isSensitiveConfigPlaceholder(value) {
  return value === undefined || value === null || value === '' || value === STORAGE_MASK_VALUE;
}

function mergeStorageConfigForSensitiveTest(existingConfig = {}, testConfig = {}, sensitiveKeys = STORAGE_SENSITIVE_KEYS) {
  const mergedConfig = {
    ...(testConfig || {}),
  };

  for (const key of sensitiveKeys) {
    const hasTestValue = Object.prototype.hasOwnProperty.call(mergedConfig, key);
    if (!hasTestValue || isSensitiveConfigPlaceholder(mergedConfig[key])) {
      const existingValue = existingConfig?.[key];
      if (!isSensitiveConfigPlaceholder(existingValue)) {
        mergedConfig[key] = existingValue;
      }
    }
  }

  return mergedConfig;
}

function sanitizeStorageChannel(storage = {}) {
  const nextStorage = {
    ...storage,
    config: {
      ...(storage.config || {}),
    },
  };

  for (const key of STORAGE_SENSITIVE_KEYS) {
    if (nextStorage.config[key] !== undefined) {
      nextStorage.config[key] = STORAGE_MASK_VALUE;
    }
  }

  return nextStorage;
}

function sanitizeStorageChannels(storages = []) {
  return storages.map((storage) => sanitizeStorageChannel(storage));
}

function sanitizeSystemConfig(config) {
  const sanitized = structuredClone(config);

  if (sanitized.jwt?.secret !== undefined) {
    sanitized.jwt.secret = '******';
  }

  if (sanitized.admin) {
    delete sanitized.admin.password;
    delete sanitized.admin.passwordHash;
  }

  if (sanitized.security) {
    delete sanitized.security.guestUploadTicketRevision;
  }

  if (Array.isArray(sanitized.storage?.storages)) {
    sanitized.storage.storages = sanitizeStorageChannels(sanitized.storage.storages);
  }

  return sanitized;
}

export {
  STORAGE_MASK_VALUE,
  STORAGE_SENSITIVE_KEYS,
  isStorageSensitiveKey,
  isSensitiveConfigPlaceholder,
  mergeStorageConfigForSensitiveTest,
  sanitizeStorageChannel,
  sanitizeStorageChannels,
  sanitizeSystemConfig,
};
