function createSystemConfigService({
  readRuntimeConfig,
  writeRuntimeConfig,
  invalidateSystemConfigCache,
  applySystemConfigUpdates,
} = {}) {
  return {
    updateConfig(body = {}) {
      const config = readRuntimeConfig();
      applySystemConfigUpdates(config, body);
      writeRuntimeConfig(config);
      invalidateSystemConfigCache();
    },
  };
}

export { createSystemConfigService };
