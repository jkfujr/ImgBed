function createSystemConfigService({
  readRuntimeConfig,
  writeRuntimeConfig,
  cacheInvalidation,
  applySystemConfigUpdates,
} = {}) {
  return {
    updateConfig(body = {}) {
      const config = readRuntimeConfig();
      applySystemConfigUpdates(config, body);
      writeRuntimeConfig(config);
      cacheInvalidation.invalidateSystemConfig();
    },
  };
}

export { createSystemConfigService };
