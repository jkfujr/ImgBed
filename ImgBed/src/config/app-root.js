import path from 'path';
import { fileURLToPath } from 'url';

export function resolveAppRoot({
  env = process.env,
  pathImpl = path,
  fileURLToPathImpl = fileURLToPath,
  importMetaUrl = import.meta.url,
} = {}) {
  if (env.IMGBED_APP_ROOT) {
    return pathImpl.resolve(env.IMGBED_APP_ROOT);
  }

  return pathImpl.resolve(pathImpl.dirname(fileURLToPathImpl(importMetaUrl)), '../..');
}

export function resolveAppPath(relativePath, options = {}) {
  const pathImpl = options.pathImpl || path;
  return pathImpl.resolve(resolveAppRoot(options), relativePath);
}
