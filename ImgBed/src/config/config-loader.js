import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function generateRandomString(length, randomBytes = crypto.randomBytes) {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export function buildDefaultConfig({ jwtSecret } = {}) {
  return {
    server: {
      port: 13000,
      host: '0.0.0.0',
    },
    database: {
      path: './data/database.sqlite',
    },
    jwt: {
      secret: jwtSecret || generateRandomString(128),
      expiresIn: '7d',
    },
    admin: {
      username: 'admin',
      password: 'admin',
    },
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
          config: {
            basePath: './data/storage',
          },
        },
      ],
    },
    security: {
      corsOrigin: '*',
      guestUploadEnabled: false,
      uploadPassword: '',
    },
    upload: {
      quotaCheckMode: 'auto',
      fullCheckIntervalHours: 6,
    },
    performance: {
      s3Multipart: {
        enabled: true,
        concurrency: 4,
        maxConcurrency: 8,
        minPartSize: 5242880,
      },
      responseCache: {
        enabled: true,
        ttlSeconds: 60,
        maxKeys: 1000,
      },
      quotaEventsArchive: {
        enabled: true,
        retentionDays: 30,
        batchSize: 500,
        maxBatchesPerRun: 10,
        scheduleHour: 3,
      },
    },
  };
}

function writeConfigFile({ fsImpl, configPath, config }) {
  fsImpl.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export function loadConfigFile({
  appRoot,
  logger,
  fsImpl = fs,
  pathImpl = path,
  randomBytes = crypto.randomBytes,
  now = () => new Date().toISOString().replace(/[:.]/g, '-'),
} = {}) {
  const dataRoot = pathImpl.join(appRoot, 'data');
  const configPath = pathImpl.join(dataRoot, 'config.json');

  fsImpl.mkdirSync(dataRoot, { recursive: true });

  const createFreshConfig = () => buildDefaultConfig({
    jwtSecret: generateRandomString(128, randomBytes),
  });

  if (!fsImpl.existsSync(configPath)) {
    const config = createFreshConfig();
    writeConfigFile({ fsImpl, configPath, config });
    logger.info({ configPath }, '未找到 config.json，已自动创建默认配置');
    logger.info({ configPath }, '已为默认配置生成新的 JWT 密钥');
    return config;
  }

  const rawData = fsImpl.readFileSync(configPath, 'utf8');

  try {
    return JSON.parse(rawData);
  } catch (err) {
    const backupPath = `${configPath}.invalid-${now()}`;
    fsImpl.writeFileSync(backupPath, rawData, 'utf8');

    const config = createFreshConfig();
    writeConfigFile({ fsImpl, configPath, config });

    logger.warn({ err, configPath, backupPath }, 'config.json 无法解析，已备份并按默认配置重建');
    return config;
  }
}
