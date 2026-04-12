import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const testsDir = path.join(rootDir, 'test');
const configPath = path.join(rootDir, 'ImgBed', 'data', 'config.json');

function createSafeConfig() {
  return {
    server: { port: 13000, host: '0.0.0.0' },
    database: { path: './data/database.sqlite' },
    jwt: { secret: 'dev-secret-for-local-tests-only', expiresIn: '7d' },
    admin: { username: 'admin', password: 'admin' },
    storage: {
      default: 'local-1',
      allowedUploadChannels: ['local-1'],
      failoverEnabled: true,
      storages: [
        {
          id: 'local-1',
          type: 'local',
          name: 'Local Storage',
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
  };
}

function ensureValidConfigFile() {
  try {
    JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    fs.writeFileSync(configPath, JSON.stringify(createSafeConfig(), null, 2), 'utf8');
  }
}

ensureValidConfigFile();

const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

for (const file of files) {
  const filePath = path.join(testsDir, file);
  const fileUrl = pathToFileURL(filePath).href;
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import(${JSON.stringify(fileUrl)}).then(() => process.exit(process.exitCode ?? 0)).catch((err) => { console.error(err); process.exit(1); });`,
  ], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
