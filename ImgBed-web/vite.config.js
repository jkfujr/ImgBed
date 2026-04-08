import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve('./node_modules/react'),
      'react-dom': path.resolve('./node_modules/react-dom'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:13000',
        changeOrigin: true,
        timeout: 30000,  // 30秒超时
        configure: (proxy) => {
          // 代理错误处理
          proxy.on('error', (err, req, res) => {
            console.error('API 代理错误:', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                code: 502,
                message: '后端服务暂时不可用，请稍后重试'
              }));
            }
          });

          proxy.on('proxyReq', (proxyReq) => {
            // 移除 Connection: close 请求头，避免连接过早关闭
            proxyReq.removeHeader('connection');
            proxyReq.setHeader('Connection', 'keep-alive');
            // 设置请求超时
            proxyReq.setTimeout(30000);
          });

          proxy.on('proxyRes', (proxyRes) => {
            // 设置响应超时
            proxyRes.setTimeout(30000);
          });
        }
      },
      // 匹配以 12 位 Hex 哈希 + 下划线开头的 ID
      '^/[0-9a-f]{12}_.*': {
        target: 'http://127.0.0.1:13000',
        changeOrigin: true,
        timeout: 30000,  // 30秒超时
        configure: (proxy) => {
          // 图片代理错误处理
          proxy.on('error', (err, req, res) => {
            console.error('图片代理错误:', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('图片加载失败，请刷新重试');
            }
          });

          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('connection');
            proxyReq.setHeader('Connection', 'keep-alive');
            proxyReq.setTimeout(30000);
          });

          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.setTimeout(30000);
          });
        }
      }
    }
  }
})
