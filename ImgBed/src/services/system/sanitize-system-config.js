const STORAGE_SENSITIVE_KEYS = ['secretAccessKey', 'botToken', 'token', 'webhookUrl', 'authHeader'];

export function sanitizeSystemConfig(config) {
  const sanitized = structuredClone(config);

  if (sanitized.jwt?.secret !== undefined) {
    sanitized.jwt.secret = '******';
  }

  if (Array.isArray(sanitized.storage?.storages)) {
    sanitized.storage.storages = sanitized.storage.storages.map((storage) => {
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
    });
  }

  return sanitized;
}
