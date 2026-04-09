import express from 'express';
import pinoHttp from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import { registerErrorHandlers, notFoundHandler } from './middleware/errorHandler.js';
import { createLogger } from './utils/logger.js';
import authRouter from './routes/auth.js';
import apiTokensRouter from './routes/api-tokens.js';
import uploadRouter from './routes/upload.js';
import filesRouter from './routes/files.js';
import dirsRouter from './routes/directories.js';
import systemRouter from './routes/system.js';
import viewRouter from './routes/view.js';
import publicRouter from './routes/public.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('app');
const app = express();

app.disable('x-powered-by');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 全局中间件
app.use(pinoHttp({ logger }));

app.use((req, res, next) => {
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

// 挂载图片直读路由到根路径
app.use('/', viewRouter);

// 静态文件服务（前端资源）
const staticPath = path.join(__dirname, '..', 'static');
app.use(express.static(staticPath));

// SPA 回退：所有未匹配的路由返回 index.html（如果存在）
app.get('*', (_req, res) => {
  const indexPath = path.join(staticPath, 'index.html');

  // 检查 index.html 是否存在
  import('fs').then(fs => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send('ImgBed 后端 API 正在运行！前端文件未找到，请先构建前端。');
    }
  });
});

app.use(notFoundHandler);
registerErrorHandlers(app);

export default app;
