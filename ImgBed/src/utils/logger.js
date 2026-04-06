import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false,
      messageFormat: '{msg}',
    },
  },
});

/**
 * 创建带命名空间的子 logger
 * @param {string} module - 模块名称
 */
export function createLogger(module) {
  return logger.child({ module });
}

export default logger;
