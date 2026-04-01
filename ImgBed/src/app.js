const { Hono } = require('hono');
const { cors } = require('hono/cors');
const { logger } = require('hono/logger');
const config = require('./config');
const { registerErrorHandlers } = require('./middleware/errorHandler');

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
const authRouter = require('./routes/auth');
app.route('/api/auth', authRouter);

const apiTokensRouter = require('./routes/api-tokens');
app.route('/api/api-tokens', apiTokensRouter);

const uploadRouter = require('./routes/upload');
app.route('/api/upload', uploadRouter);

const filesRouter = require('./routes/files');
app.route('/api/files', filesRouter);

// 挂载目录管理分发路由
const dirsRouter = require('./routes/directories');
app.route('/api/directories', dirsRouter);

// 挂载系统配置路由
const systemRouter = require('./routes/system');
app.route('/api/system', systemRouter);

// 挂载图片直读路由到根路径 (放在 API 路由之后，避免冲突)
const viewRouter = require('./routes/view');
app.route('/', viewRouter);

registerErrorHandlers(app);

module.exports = app;
