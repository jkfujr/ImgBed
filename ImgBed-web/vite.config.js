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
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // 移除 Connection: close 请求头，避免连接过早关闭
            proxyReq.removeHeader('connection');
            proxyReq.setHeader('Connection', 'keep-alive');
          });
        }
      },
      // 匹配以 12 位 Hex 哈希 + 下划线开头的 ID
      '^/[0-9a-f]{12}_.*': {
        target: 'http://127.0.0.1:13000',
        changeOrigin: true
      }
    }
  }
})
