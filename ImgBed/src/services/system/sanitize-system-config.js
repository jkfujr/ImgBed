const STORAGE_SENSITIVE_KEYS = ['secretAccessKey', 'botToken', 'token', 'webhookUrl', 'authHeader', 'password'];

function sanitizeStorageChannel(storage = {}) {
  const nextStorage = {
    ...storage,
    config: {
      ...(storage.config || {}),
    },
  };

  for (const key of STORAGE_SENSITIVE_KEYS) {
    if (nextStorage.config[key] !== undefined) {
      nextStorage.config[key] = '***';
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
  STORAGE_SENSITIVE_KEYS,
  sanitizeStorageChannel,
  sanitizeStorageChannels,
  sanitizeSystemConfig,
};
