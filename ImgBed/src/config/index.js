import { createLogger } from '../utils/logger.js';
import { resolveAppRoot } from './app-root.js';
import { createConfigRepository } from './config-loader.js';

const log = createLogger('config');
const repository = createConfigRepository({
  appRoot: resolveAppRoot(),
  logger: log,
});

function loadStartupConfig() {
  return repository.loadStartupConfig();
}

function readRuntimeConfig() {
  return repository.readRuntimeConfig();
}

function writeRuntimeConfig(nextConfig) {
  return repository.writeRuntimeConfig(nextConfig);
}

function getLastKnownGoodConfig() {
  return repository.getLastKnownGoodConfig();
}

export {
  loadStartupConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  getLastKnownGoodConfig,
};
