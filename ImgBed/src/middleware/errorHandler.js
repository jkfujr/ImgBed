import { AppError } from '../errors/AppError.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('errorHandler');

const registerErrorHandlers = (app) => {
  app.use((err, _req, res, _next) => {
    const status = err instanceof AppError ? err.status : (err.status || 500);

    if (status >= 500) {
      log.error({ err }, '应用错误');
    }

    res.status(status).json({
      code: status,
      message: err.message || '内部服务器错误'
    });
  });
};

const notFoundHandler = (_req, res) => {
  res.status(404).json({
    code: 404,
    message: '未找到请求的资源'
  });
};

export { registerErrorHandlers, notFoundHandler };
