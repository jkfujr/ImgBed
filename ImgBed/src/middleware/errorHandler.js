import { AppError, ConfigFileError } from '../errors/AppError.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('errorHandler');

const registerErrorHandlers = (app) => {
  app.use((err, _req, res, _next) => {
    const status = err instanceof AppError ? err.status : (err.status || 500);
    const isConfigFileError = err instanceof ConfigFileError;

    if (status >= 500) {
      log.error({ err }, '应用错误');
    }

    res.status(status).json({
      code: status,
      message: isConfigFileError ? '配置文件不可用，请修复后重试' : (err.message || '内部服务器错误'),
    });
  });
};

const notFoundHandler = (_req, res) => {
  res.status(404).json({
    code: 404,
    message: '未找到请求的资源',
  });
};

export { registerErrorHandlers, notFoundHandler };
