import express from 'express';
import config from './config/index.js';
import { registerErrorHandlers, notFoundHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import apiTokensRouter from './routes/api-tokens.js';
import uploadRouter from './routes/upload.js';
import filesRouter from './routes/files.js';
import dirsRouter from './routes/directories.js';
import systemRouter from './routes/system.js';
import viewRouter from './routes/view.js';

const app = express();

app.disable('x-powered-by');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 全局中间件
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use((req, res, next) => {
  const origin = config.security?.corsOrigin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// 基础测试路由
app.get('/', (_req, res) => {
  return res.send('ImgBed 后端 API 正在运行！');
});

// 挂载 API 子路由模块
app.use('/api/auth', authRouter);

app.use('/api/api-tokens', apiTokensRouter);

app.use('/api/upload', uploadRouter);

app.use('/api/files', filesRouter);

// 挂载目录管理分发路由
app.use('/api/directories', dirsRouter);

// 挂载系统配置路由
app.use('/api/system', systemRouter);

// 挂载图片直读路由到根路径 (放在 API 路由之后，避免冲突)
app.use('/', viewRouter);

registerErrorHandlers(app);
app.use(notFoundHandler);

export default app;
