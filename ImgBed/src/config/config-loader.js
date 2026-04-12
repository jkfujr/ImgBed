import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { ConfigFileError } from '../errors/AppError.js';

const DEFAULT_CONFIG_CACHE_TTL_MS = 5000;
const LOCAL_TEST_JWT_SECRET = 'dev-secret-for-local-tests-only';

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

function stripUtf8Bom(rawData) {
  return rawData.charCodeAt(0) === 0xFEFF ? rawData.slice(1) : rawData;
}

function parseConfigText(rawData) {
  return JSON.parse(stripUtf8Bom(rawData));
}

function createFreshConfig(randomBytes) {
  return buildDefaultConfig({
    jwtSecret: generateRandomString(128, randomBytes),
  });
}

function createInvalidConfigError({ kind, configPath, backupPath = null, cause, message }) {
  return new ConfigFileError({
    kind,
    configPath,
    backupPath,
    cause,
    status: 500,
    message,
  });
}

function warnIfUsingLocalTestSecret({ config, logger, configPath, env = process.env }) {
  if (env.NODE_ENV === 'test') {
    return;
  }

  if (config?.jwt?.secret === LOCAL_TEST_JWT_SECRET) {
    logger.warn({ configPath }, '当前运行配置使用了测试专用 JWT 密钥，请检查是否有测试链路污染了真实配置');
  }
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

  if (!fsImpl.existsSync(configPath)) {
    const config = createFreshConfig(randomBytes);
    writeConfigFile({ fsImpl, configPath, config });
    logger.info({ configPath }, '未找到 config.json，已自动创建默认配置');
    logger.info({ configPath }, '已为默认配置生成新的 JWT 密钥');
    warnIfUsingLocalTestSecret({ config, logger, configPath });
    return config;
  }

  const rawData = fsImpl.readFileSync(configPath, 'utf8');

  try {
    const config = parseConfigText(rawData);
    warnIfUsingLocalTestSecret({ config, logger, configPath });
    return config;
  } catch (cause) {
    const backupPath = `${configPath}.invalid-${now()}`;
    fsImpl.writeFileSync(backupPath, rawData, 'utf8');
    throw createInvalidConfigError({
      kind: 'invalid_existing',
      configPath,
      backupPath,
      cause,
      message: 'config.json 格式非法，已备份原文件，请修复后重新启动服务',
    });
  }
}

export function createConfigRepository({
  appRoot,
  logger,
  fsImpl = fs,
  pathImpl = path,
  randomBytes = crypto.randomBytes,
  now = () => new Date().toISOString().replace(/[:.]/g, '-'),
  cacheTtlMs = DEFAULT_CONFIG_CACHE_TTL_MS,
  dateNow = () => Date.now(),
} = {}) {
  const dataRoot = pathImpl.join(appRoot, 'data');
  const configPath = pathImpl.join(dataRoot, 'config.json');

  let cacheEntry = null;

  function setCache(value, stats) {
    cacheEntry = {
      value,
      mtimeMs: Number(stats?.mtimeMs || 0),
      expireAt: dateNow() + cacheTtlMs,
    };
    return value;
  }

  function getFileStats() {
    return fsImpl.statSync(configPath);
  }

  function parseExistingFile() {
    const rawData = fsImpl.readFileSync(configPath, 'utf8');
    const value = parseConfigText(rawData);
    const stats = getFileStats();
    return { rawData, value, stats };
  }

  function ensureDataRoot() {
    fsImpl.mkdirSync(dataRoot, { recursive: true });
  }

  return {
    getConfigPath() {
      return configPath;
    },

    loadStartupConfig() {
      ensureDataRoot();

      if (!fsImpl.existsSync(configPath)) {
        const config = createFreshConfig(randomBytes);
        writeConfigFile({ fsImpl, configPath, config });
        logger.info({ configPath }, '未找到 config.json，已自动创建默认配置');
        logger.info({ configPath }, '已为默认配置生成新的 JWT 密钥');
        warnIfUsingLocalTestSecret({ config, logger, configPath });
        return setCache(config, getFileStats());
      }

      try {
        const { value, stats } = parseExistingFile();
        warnIfUsingLocalTestSecret({ config: value, logger, configPath });
        return setCache(value, stats);
      } catch (cause) {
        if (cause instanceof ConfigFileError) {
          throw cause;
        }

        const rawData = fsImpl.readFileSync(configPath, 'utf8');
        const backupPath = `${configPath}.invalid-${now()}`;
        fsImpl.writeFileSync(backupPath, rawData, 'utf8');
        throw createInvalidConfigError({
          kind: 'invalid_existing',
          configPath,
          backupPath,
          cause,
          message: 'config.json 格式非法，已备份原文件，请修复后重新启动服务',
        });
      }
    },

    readRuntimeConfig() {
      if (!fsImpl.existsSync(configPath)) {
        return this.loadStartupConfig();
      }

      try {
        const stats = getFileStats();
        const currentTime = dateNow();
        if (
          cacheEntry &&
          cacheEntry.expireAt > currentTime &&
          cacheEntry.mtimeMs === Number(stats.mtimeMs || 0)
        ) {
          return cacheEntry.value;
        }

        const rawData = fsImpl.readFileSync(configPath, 'utf8');
        const value = parseConfigText(rawData);
        warnIfUsingLocalTestSecret({ config: value, logger, configPath });
        return setCache(value, stats);
      } catch (cause) {
        if (cacheEntry?.value) {
          logger.warn({ err: cause, configPath }, '配置文件读取失败，继续使用最近一次有效配置');
          return cacheEntry.value;
        }

        throw createInvalidConfigError({
          kind: 'runtime_invalid',
          configPath,
          cause,
          message: '配置文件损坏，且当前进程没有可用的有效配置快照',
        });
      }
    },

    writeRuntimeConfig(nextConfig) {
      ensureDataRoot();
      writeConfigFile({ fsImpl, configPath, config: nextConfig });
      warnIfUsingLocalTestSecret({ config: nextConfig, logger, configPath });
      return setCache(nextConfig, getFileStats());
    },

    getLastKnownGoodConfig() {
      if (!cacheEntry?.value) {
        throw createInvalidConfigError({
          kind: 'runtime_invalid',
          configPath,
          message: '启动配置尚未加载，无法提供配置快照',
        });
      }

      return cacheEntry.value;
    },

    peekLastKnownGoodConfig() {
      return cacheEntry?.value || null;
    },
  };
}
