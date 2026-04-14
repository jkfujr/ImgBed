import { spawnSync } from 'node:child_process';

import {
  cleanupPath,
  createTempAppRoot,
  resolveProjectPath,
} from './runtime-test-helpers.mjs';

const JSON_RESULT_TAG = 'JSON_RESULT ';

function runIsolatedModuleScript(script, {
  appRootPrefix = 'imgbed-isolated-',
  env = {},
} = {}) {
  const appRoot = createTempAppRoot(appRootPrefix);

  try {
    return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: resolveProjectPath(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        IMGBED_APP_ROOT: appRoot,
        ...env,
      },
      encoding: 'utf8',
    });
  } finally {
    cleanupPath(appRoot);
  }
}

function parseJsonResult(execution, tag = JSON_RESULT_TAG) {
  const combinedOutput = `${execution.stdout || ''}\n${execution.stderr || ''}`;
  const line = combinedOutput
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(tag));

  if (!line) {
    throw new Error(`未找到结果标记 ${tag}。实际输出：\n${combinedOutput}`);
  }

  return JSON.parse(line.slice(tag.length));
}

export {
  JSON_RESULT_TAG,
  parseJsonResult,
  runIsolatedModuleScript,
};
