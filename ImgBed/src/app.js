import express from 'express';
import compression from 'compression';
import pinoHttp from 'pino-http';
import path from 'path';
import { resolveAppPath } from './config/app-root.js';
import { getLastKnownGoodConfig } from './config/index.js';
import { registerErrorHandlers, notFoundHandler } from './middleware/errorHandler.js';
import { sqlite } from './database/index.js';
import { createLogger } from './utils/logger.js';
import authRouter from './routes/auth.js';
import apiTokensRouter from './routes/api-tokens.js';
import uploadRouter from './routes/upload.js';
import { createFilesRouter } from './routes/files.js';
import dirsRouter from './routes/directories.js';
import { createSystemRouter } from './routes/system.js';
import viewRouter from './routes/view.js';
import publicRouter from './routes/public.js';
import storageManager from './storage/manager.js';
import { createFilesMaintenanceService } from './services/files/files-maintenance-service.js';
import { defaultMaintenanceTaskExecutor } from './services/maintenance/default-maintenance-task-executor.js';
import { createMaintenanceService } from './services/system/maintenance-service.js';

const logger = createLogger('app');
const app = express();
const staticPath = resolveAppPath('static');
const indexPath = path.join(staticPath, 'index.html');
const filesMaintenanceService = createFilesMaintenanceService({
  db: sqlite,
  storageManager,
  logger: createLogger('files'),
  taskExecutor: defaultMaintenanceTaskExecutor,
});
const systemMaintenanceService = createMaintenanceService({
  db: sqlite,
  storageManager,
  logger: createLogger('system'),
  taskExecutor: defaultMaintenanceTaskExecutor,
});
const filesRouter = createFilesRouter({
  filesMaintenanceService,
});
const systemRouter = createSystemRouter({
  maintenanceService: systemMaintenanceService,
});

function isSpaNavigationRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  const accept = req.get('Accept') || '';
  const acceptsHtml = accept.includes('text/html') || accept.includes('application/xhtml+xml');
  if (!acceptsHtml) {
    return false;
  }

  return path.extname(req.path || '') === '';
}

app.disable('x-powered-by');

// HTTP 响应压缩
app.use(compression({
  filter: (req, res) => {
    // 不压缩图片等二进制内容
    if (req.path.startsWith('/i/') || req.path.startsWith('/view/')) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024, // 只压缩 >1KB 的响应
  level: 6, // 压缩级别 1-9
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 全局中间件
app.use(pinoHttp({ logger }));

app.use((req, res, next) => {
  const config = getLastKnownGoodConfig();
  const origin = config.security?.corsOrigin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Upload-Password');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// 挂载 API 子路由模块（优先处理 API 请求）
app.use('/api/auth', authRouter);

app.use('/api/api-tokens', apiTokensRouter);

app.use('/api/upload', uploadRouter);

app.use('/api/files', filesRouter);

// 挂载目录管理分发路由
app.use('/api/directories', dirsRouter);

// 挂载系统配置路由
app.use('/api/system', systemRouter);

// 挂载公开接口路由
app.use('/api/public', publicRouter);

// API 未命中必须在进入根路径路由前返回 JSON 404
app.use('/api', notFoundHandler);

// 挂载图片直读路由到根路径
app.use('/', viewRouter);

// 静态文件服务（前端资源）
app.use(express.static(staticPath));

// 仅浏览器导航请求使用 SPA 回退
app.use((req, res, next) => {
  if (!isSpaNavigationRequest(req)) {
    next();
    return;
  }

  res.sendFile(indexPath, (error) => {
    if (error) {
      next(error);
    }
  });
});

app.use(notFoundHandler);
registerErrorHandlers(app);

export default app;
