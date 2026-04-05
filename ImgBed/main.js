import app from './src/app.js';
import config from './src/config/index.js';
import { initDb } from './src/database/index.js';

const port = config.server?.port || 13000;
const host = config.server?.host || '0.0.0.0';

const handleServerError = (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[服务端] 端口 ${port} 已被占用，请停止现有进程或修改配置后重试。`);
    process.exit(1);
  }

  console.error('[服务端] 启动失败:', error);
  process.exit(1);
};

process.on('uncaughtException', handleServerError);

// 在启动服务前初始化数据库
try {
  initDb();
} catch (error) {
  console.error('[服务端] 数据库初始化失败，应用终止启动:', error);
  process.exit(1);
}

console.log(`[服务端] 正在启动服务，地址: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

const server = app.listen(Number(port), host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`[服务端] 监听中，地址: http://${displayHost}:${port}`);
});

server.on('error', handleServerError);
