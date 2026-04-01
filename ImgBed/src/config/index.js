const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const configPath = path.resolve(__dirname, '../../config.json');

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
    console.log(`[配置] 未找到 config.json，系统正自动生成默认配置...`);
    
    // 生成新的配置
    config = { ...defaultConfig };
    // 随机生成 128 位的 JWT Secret
    config.jwt.secret = generateRandomString(128);
    
    // 写入配置到文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`[配置] 已在 ${configPath} 创建默认配置文件，并生成随机 JWT 秘钥。`);
  }
} catch (error) {
  console.error('[配置] 初始化配置失败:', error);
  process.exit(1);
}

module.exports = config;
