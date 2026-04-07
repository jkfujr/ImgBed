import http from 'http';

const testFileId = '54b9a0083f7f_142986674_p0.png'; // 从数据库获取的测试文件ID
const host = 'localhost';
const port = 13000;

console.log('测试图片缓存 304 响应\n');

// 第一次请求：获取完整资源和缓存头
const firstRequest = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: `/${testFileId}`,
      method: 'GET',
      headers: {
        'Referer': 'http://localhost:3000/admin'
      }
    };

    console.log('第一次请求（获取完整资源）:');
    const req = http.request(options, (res) => {
      console.log(`  状态码: ${res.statusCode}`);
      console.log(`  ETag: ${res.headers['etag'] || '无'}`);
      console.log(`  Last-Modified: ${res.headers['last-modified'] || '无'}`);
      console.log(`  Cache-Control: ${res.headers['cache-control'] || '无'}`);
      console.log(`  Content-Length: ${res.headers['content-length'] || '无'}`);

      let dataSize = 0;
      res.on('data', (chunk) => {
        dataSize += chunk.length;
      });

      res.on('end', () => {
        console.log(`  实际接收数据: ${dataSize} bytes\n`);
        resolve({
          etag: res.headers['etag'],
          lastModified: res.headers['last-modified']
        });
      });

      res.on('error', reject);
    });

    req.on('error', (err) => {
      console.error('请求错误:', err.message);
      reject(err);
    });
    req.end();
  });
};

// 第二次请求：使用 If-None-Match 测试 304
const secondRequest = (etag, lastModified) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: `/${testFileId}`,
      method: 'GET',
      headers: {
        'Referer': 'http://localhost:3000/admin',
        'If-None-Match': etag,
        'If-Modified-Since': lastModified
      }
    };

    console.log('第二次请求（带缓存头）:');
    console.log(`  If-None-Match: ${etag}`);
    console.log(`  If-Modified-Since: ${lastModified}`);

    const req = http.request(options, (res) => {
      console.log(`  状态码: ${res.statusCode}`);
      console.log(`  Content-Length: ${res.headers['content-length'] || '0'}`);

      let dataSize = 0;
      res.on('data', (chunk) => {
        dataSize += chunk.length;
      });

      res.on('end', () => {
        console.log(`  实际接收数据: ${dataSize} bytes\n`);

        if (res.statusCode === 304) {
          console.log('✓ 缓存验证成功！服务器返回 304 Not Modified');
          console.log('✓ 浏览器将使用本地缓存，节省带宽');
        } else if (res.statusCode === 200) {
          console.log('✗ 服务器返回 200，未使用缓存机制');
        }

        resolve();
      });
    });

    req.on('error', reject);
    req.end();
  });
};

// 执行测试
(async () => {
  try {
    const { etag, lastModified } = await firstRequest();

    if (!etag && !lastModified) {
      console.log('✗ 服务器未返回 ETag 或 Last-Modified，缓存优化未生效');
      process.exit(1);
    }

    await secondRequest(etag, lastModified);
  } catch (error) {
    console.error('测试失败:', error.message);
    console.error('请确保后端服务运行在 http://localhost:3000');
    process.exit(1);
  }
})();
