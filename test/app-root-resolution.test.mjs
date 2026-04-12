import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function createTempAppRoot() {
  const baseDir = path.join(ROOT, '.tmp-app-root-tests');
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.mkdtempSync(path.join(baseDir, 'app-root-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeConfig(appRoot) {
  const dataRoot = path.join(appRoot, 'data');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'config.json'), JSON.stringify({
    server: { port: 13000, host: '127.0.0.1' },
    database: { path: './data/runtime-test.sqlite' },
    jwt: { secret: 'temp-secret', expiresIn: '7d' },
    admin: { username: 'admin', password: 'admin' },
    storage: {
      default: 'local-1',
      allowedUploadChannels: ['local-1'],
      failoverEnabled: true,
      storages: [
        {
          id: 'local-1',
          type: 'local',
          name: '本地存储',
          enabled: true,
          allowUpload: true,
          config: { basePath: './data/storage' },
        },
      ],
    },
    security: { corsOrigin: '*', guestUploadEnabled: false, uploadPassword: '' },
    upload: { quotaCheckMode: 'auto', fullCheckIntervalHours: 6 },
    performance: {
      s3Multipart: { enabled: true, concurrency: 4, maxConcurrency: 8, minPartSize: 5242880 },
      responseCache: { enabled: true, ttlSeconds: 60, maxKeys: 1000 },
      quotaEventsArchive: { enabled: true, retentionDays: 30, batchSize: 500, maxBatchesPerRun: 10, scheduleHour: 3 },
    },
  }, null, 2), 'utf8');
}

function testConfigAndDatabaseRespectImgbedAppRoot() {
  const appRoot = createTempAppRoot();
  const outputPath = path.join(appRoot, 'observed-paths.json');

  try {
    writeConfig(appRoot);

    const evalScript = `
      const fs = await import('node:fs');
      const configModule = await import('./ImgBed/src/config/index.js');
      const config = configModule.loadStartupConfig();
      const databaseModule = await import('./ImgBed/src/database/index.js');
      const localModule = await import('./ImgBed/src/storage/local.js');
      const localStorage = new localModule.default({ basePath: './data/storage' });
      fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({
        configPath: configModule.getConfigPath(),
        dbPath: databaseModule.dbPath,
        storageName: config.storage.storages[0].name,
        localBasePath: localStorage.basePath,
      }), 'utf8');
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', evalScript], {
      cwd: ROOT,
      env: {
        ...process.env,
        IMGBED_APP_ROOT: appRoot,
      },
      stdio: 'inherit',
    });

    assert.equal(result.status, 0);

    const observed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(observed.configPath, path.join(appRoot, 'data', 'config.json'));
    assert.equal(observed.dbPath, path.join(appRoot, 'data', 'runtime-test.sqlite'));
    assert.equal(observed.storageName, '本地存储');
    assert.equal(observed.localBasePath, path.join(appRoot, 'data', 'storage'));
    console.log('  [OK] app root resolution: config and database honor IMGBED_APP_ROOT');
  } finally {
    cleanup(appRoot);
  }
}

function main() {
  console.log('running app-root-resolution tests...');
  testConfigAndDatabaseRespectImgbedAppRoot();
  console.log('app-root-resolution tests passed');
}

main();
