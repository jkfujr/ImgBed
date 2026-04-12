import path from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '../utils/logger.js';
import { loadConfigFile } from './config-loader.js';

const log = createLogger('config');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const config = loadConfigFile({
  appRoot,
  logger: log,
});

export default config;
