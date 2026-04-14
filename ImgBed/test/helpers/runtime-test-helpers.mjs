import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const helpersDir = path.dirname(fileURLToPath(import.meta.url));
const testRoot = path.resolve(helpersDir, '..');
const projectRoot = path.resolve(testRoot, '..');
const tempCleanupTargets = new Set();
let cleanupHookInstalled = false;

function createLoggerDouble() {
  const records = {
    info: [],
    warn: [],
    error: [],
    fatal: [],
  };

  return {
    records,
    logger: {
      info(...args) {
        records.info.push(args);
      },
      warn(...args) {
        records.warn.push(args);
      },
      error(...args) {
        records.error.push(args);
      },
      fatal(...args) {
        records.fatal.push(args);
      },
    },
  };
}

function createTempAppRoot(prefix = 'imgbed-runtime-') {
  const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  if (!cleanupHookInstalled) {
    process.on('exit', () => {
      for (const targetPath of tempCleanupTargets) {
        try {
          fs.rmSync(targetPath, { recursive: true, force: true });
        } catch {
          // 退出阶段只做尽力清理，不阻断进程
        }
      }
    });
    cleanupHookInstalled = true;
  }

  tempCleanupTargets.add(tempPath);
  return tempPath;
}

function cleanupPath(targetPath) {
  tempCleanupTargets.delete(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function resolveProjectPath(...segments) {
  return path.join(projectRoot, ...segments);
}

function resolveProjectModuleUrl(...segments) {
  return pathToFileURL(resolveProjectPath(...segments)).href;
}

function createFetchUrl(server, requestPath) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}${requestPath}`;
}

async function requestServer(server, requestPath, { method = 'GET', headers = {} } = {}) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: requestPath,
      method,
      headers,
      agent: false,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.on('error', reject);
    request.end();
  });
}

async function startHttpApp({ appRoot } = {}) {
  const previousAppRoot = process.env.IMGBED_APP_ROOT;
  process.env.IMGBED_APP_ROOT = appRoot;

  const configModule = await import(resolveProjectModuleUrl('src', 'config', 'index.js'));
  configModule.loadStartupConfig();

  const appModule = await import(resolveProjectModuleUrl('src', 'app.js'));
  const app = appModule.default;

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  return {
    server,
    async stop() {
      await new Promise((resolve) => server.close(resolve));

      if (previousAppRoot === undefined) {
        delete process.env.IMGBED_APP_ROOT;
      } else {
        process.env.IMGBED_APP_ROOT = previousAppRoot;
      }
    },
  };
}

export {
  cleanupPath,
  createFetchUrl,
  createLoggerDouble,
  createTempAppRoot,
  requestServer,
  resolveProjectPath,
  resolveProjectModuleUrl,
  startHttpApp,
};
