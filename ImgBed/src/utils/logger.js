import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * 创建异步日志目标
 * 使用 pino.destination() 实现异步写入，降低主流程阻塞
 */
function createAsyncDestination() {
  if (isProduction) {
    // 生产环境：异步写入 stdout，启用 4KB 缓冲
    return pino.destination({
      dest: 1, // stdout 文件描述符
      sync: false, // 异步写入
      minLength: 4096, // 4KB 缓冲区
    });
  } else {
    // 开发环境：使用 pino-pretty 的异步传输
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
        messageFormat: '{msg}',
      },
    });
  }
}

const destination = createAsyncDestination();

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  },
  destination
);

/**
 * 创建带命名空间的子 logger
 * @param {string} module - 模块名称
 */
export function createLogger(module) {
  return logger.child({ module });
}

/**
 * 优雅关闭日志系统
 * 确保进程退出前所有缓冲日志都已写入
 */
export function flushLogs() {
  return new Promise((resolve) => {
    if (destination && typeof destination.flush === 'function') {
      destination.flush(() => resolve());
    } else {
      resolve();
    }
  });
}

export default logger;
