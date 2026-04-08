import http from 'http';

const port = 13000;

console.log('验证访客密码完整流程\n');

// 测试1: 获取访客上传配置
const testGetGuestUploadConfig = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/api/public/guest-upload-config',
      method: 'GET',
      headers: {
        'Connection': 'keep-alive'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
};

// 测试2: 无密码上传（应返回401需要密码）
const testUploadWithoutPassword = () => {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36);
    const fileContent = Buffer.from('test image content');

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.jpg"',
      'Content-Type: image/jpeg',
      '',
      fileContent.toString(),
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/api/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'keep-alive'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(body);
    req.end();
  });
};

// 测试3: 正确密码上传（应返回200成功）
const testUploadWithCorrectPassword = () => {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36);
    const fileContent = Buffer.from('test image content');

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.jpg"',
      'Content-Type: image/jpeg',
      '',
      fileContent.toString(),
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/api/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'keep-alive',
        'X-Upload-Password': '114514'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(body);
    req.end();
  });
};

(async () => {
  console.log('测试1: 获取访客上传配置\n');
  try {
    const result1 = await testGetGuestUploadConfig();
    console.log('响应状态:', result1.status);
    console.log('响应体:', JSON.stringify(result1.data, null, 2));

    if (result1.status === 200 && result1.data.code === 0) {
      const { guestUploadEnabled, requirePassword } = result1.data.data;
      console.log(`✅ 测试1通过: guestUploadEnabled=${guestUploadEnabled}, requirePassword=${requirePassword}\n`);

      if (requirePassword) {
        console.log('⚠️  访客上传需要密码，前端应该重定向到 /login?tab=guest\n');
      }
    } else {
      console.log('❌ 测试1失败: 响应异常\n');
    }
  } catch (error) {
    console.log('❌ 测试1失败:', error.code, error.message, '\n');
  }

  console.log('测试2: 无密码上传（验证401响应）\n');
  try {
    const result2 = await testUploadWithoutPassword();
    console.log('响应状态:', result2.status);
    console.log('响应体:', JSON.stringify(result2.data, null, 2));

    if (result2.status === 401 && result2.data.message?.includes('上传密码')) {
      console.log('✅ 测试2通过: 正确返回401需要密码\n');
    } else {
      console.log('❌ 测试2失败: 响应异常\n');
    }
  } catch (error) {
    console.log('❌ 测试2失败:', error.code, error.message, '\n');
  }

  console.log('测试3: 正确密码上传（验证成功上传）\n');
  try {
    const result3 = await testUploadWithCorrectPassword();
    console.log('响应状态:', result3.status);
    console.log('响应体:', JSON.stringify(result3.data, null, 2));

    if (result3.status === 200 && result3.data.code === 0) {
      console.log('✅ 测试3通过: 正确密码上传成功\n');
    } else {
      console.log('❌ 测试3失败: 响应异常\n');
    }
  } catch (error) {
    console.log('❌ 测试3失败:', error.code, error.message, '\n');
  }

  console.log('总结:');
  console.log('1. 公开接口 /api/public/guest-upload-config 返回访客上传配置');
  console.log('2. 前端根据 requirePassword 决定是否重定向到登录页');
  console.log('3. 登录页有两个 Tab：访客密码（默认）和管理员登录');
  console.log('4. 访客输入密码后保存到 sessionStorage 并跳转回首页');
  console.log('5. 首页检查配置和 sessionStorage，决定是否允许上传');
})();
