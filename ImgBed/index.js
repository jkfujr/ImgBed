const { serve } = require('@hono/node-server');
const app = require('./src/app');
const config = require('./src/config');
const { initDb } = require('./src/database');

const port = config.server?.port || 13000;
const host = config.server?.host || '0.0.0.0';

// 在启动服务前初始化数据库
try {
  initDb();
} catch (error) {
  console.error('[服务端] 数据库初始化失败，应用终止启动:', error);
  process.exit(1);
}

console.log(`[服务端] 正在启动服务，地址: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);

serve({
  fetch: app.fetch,
  port: Number(port),
  hostname: host
}, (info) => {
  console.log(`[服务端] 监听中，地址: http://${info.address}:${info.port}`);
});
