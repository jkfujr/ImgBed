import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config');

const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config.json');

// 默认系统配置模板
const defaultConfig = {
  server: {
    port: 3000,
    host: "0.0.0.0"
  },
  database: {
    path: "./data/database.sqlite"
  },
  jwt: {
    secret: "", // 将在生成时随机填充
    expiresIn: "7d"
  },
  admin: {
    username: "admin",
    password: "admin"
  },
  storage: {
    default: "local-1",
    allowedUploadChannels: ["local-1"],
    // 上传失败时自动切换到其他可用渠道
    failoverEnabled: true,
    storages: [
      {
        id: "local-1",
        type: "local",
        name: "Local Storage",
        enabled: true,
        allowUpload: true,
        config: {
          basePath: "./data/storage"
        }
      }
    ]
  },
  security: {
    corsOrigin: "*",
    maxFileSize: 104857600
  },
  // 默认上传配置
  upload: {
    // 容量检查模式：auto = 自动（缓存+增量+定时校正），always = 每次上传全量检查
    quotaCheckMode: 'auto',
    // 定时全量校正间隔（小时）
    fullCheckIntervalHours: 6
  },
  // 性能优化配置
  performance: {
    // S3 Multipart 并发上传配置
    s3Multipart: {
      enabled: true,              // 是否启用并发上传
      concurrency: 4,             // 默认并发数
      maxConcurrency: 8,          // 最大并发数限制
      minPartSize: 5242880        // 最小分片大小 5MB（S3 协议要求）
    },
    // 响应缓存配置
    responseCache: {
      enabled: true,              // 是否启用响应缓存
      ttlSeconds: 60,             // 默认缓存时间（秒）
      maxKeys: 1000               // 最大缓存键数量
    },
    // 事件表归档配置
    quotaEventsArchive: {
      enabled: true,              // 是否启用归档
      retentionDays: 30,          // 保留期（天）
      batchSize: 500,             // 单批次归档数量
      maxBatchesPerRun: 10,       // 单次运行最大批次数
      scheduleHour: 3             // 每天执行时间（小时，0-23）
    }
  }
};

// 生成指定长度的随机字符串 (Hex格式)
const generateRandomString = (length) => {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
};

let config = {};

try {
  if (fs.existsSync(configPath)) {
    const rawData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(rawData);
  } else {
    log.info('未找到 config.json，系统正自动生成默认配置');

    // 生成新的配置
    config = { ...defaultConfig };
    // 随机生成 128 位的 JWT Secret
    config.jwt.secret = generateRandomString(128);

    // 写入配置到文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    log.info({ configPath }, '已创建默认配置文件，并生成随机 JWT 秘钥');
  }
} catch (error) {
  log.error({ err: error }, '初始化配置失败');
  process.exit(1);
}

export default config;
