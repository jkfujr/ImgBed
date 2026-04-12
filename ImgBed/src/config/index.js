import { createLogger } from '../utils/logger.js';
import { resolveAppRoot } from './app-root.js';
import { createConfigRepository } from './config-loader.js';

const log = createLogger('config');
const repository = createConfigRepository({
  appRoot: resolveAppRoot(),
  logger: log,
});

function getConfigPath() {
  return repository.getConfigPath();
}

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

function peekLastKnownGoodConfig() {
  return repository.peekLastKnownGoodConfig();
}

export {
  getConfigPath,
  loadStartupConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  getLastKnownGoodConfig,
  peekLastKnownGoodConfig,
};
