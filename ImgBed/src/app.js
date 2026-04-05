import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import config from './config/index.js';
import { registerErrorHandlers } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import apiTokensRouter from './routes/api-tokens.js';
import uploadRouter from './routes/upload.js';
import filesRouter from './routes/files.js';
import dirsRouter from './routes/directories.js';
import systemRouter from './routes/system.js';
import viewRouter from './routes/view.js';

const app = new Hono();

// 全局中间件
app.use('*', logger());
app.use('*', cors({
  origin: config.security?.corsOrigin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// 基础测试路由
app.get('/', (c) => {
  return c.text('ImgBed 后端 API 正在运行！');
});

// 挂载 API 子路由模块
app.route('/api/auth', authRouter);

app.route('/api/api-tokens', apiTokensRouter);

app.route('/api/upload', uploadRouter);

app.route('/api/files', filesRouter);

// 挂载目录管理分发路由
app.route('/api/directories', dirsRouter);

// 挂载系统配置路由
app.route('/api/system', systemRouter);

// 挂载图片直读路由到根路径 (放在 API 路由之后，避免冲突)
app.route('/', viewRouter);

registerErrorHandlers(app);

export default app;
