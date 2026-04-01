const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imgbed-api-token-test-'));
const tempDbPath = path.join(tempRoot, 'database.sqlite');
const tempStoragePath = path.join(tempRoot, 'storage');
const testPort = 13091;
const testHost = '127.0.0.1';

fs.mkdirSync(tempStoragePath, { recursive: true });

const baseConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.json'), 'utf8'));
const testConfig = {
  ...baseConfig,
  server: {
    ...(baseConfig.server || {}),
    port: testPort,
    host: testHost
  },
  database: {
    ...(baseConfig.database || {}),
    path: tempDbPath
  },
  storage: {
    ...(baseConfig.storage || {}),
    storages: (baseConfig.storage?.storages || []).map((storage) => {
      if (storage.type !== 'local') return storage;
      return {
        ...storage,
        config: {
          ...(storage.config || {}),
          basePath: tempStoragePath
        }
      };
    })
  }
};

fs.writeFileSync(path.join(projectRoot, 'config.json'), JSON.stringify(testConfig, null, 2), 'utf8');

const server = spawn(process.execPath, ['main.js'], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLogs = '';
server.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });

const baseUrl = `http://${testHost}:${testPort}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok) return;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error(`服务启动超时\n${serverLogs}`);
};

const request = async (method, url, { token, json, formData } = {}) => {
  const headers = {};
  let body;

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  if (formData) {
    body = formData;
  }

  const response = await fetch(`${baseUrl}${url}`, { method, headers, body });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

const cleanup = () => {
  try {
    if (!server.killed) server.kill();
  } catch (_) {}
  try {
    fs.writeFileSync(path.join(projectRoot, 'config.json'), JSON.stringify(baseConfig, null, 2), 'utf8');
  } catch (_) {}
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (_) {}
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

(async () => {
  try {
    await waitForServer();

    const loginRes = await request('POST', '/api/auth/login', {
      json: { username: baseConfig.admin.username, password: baseConfig.admin.password }
    });
    assert(loginRes.status === 200 && loginRes.data.code === 0, '管理员登录失败');
    const adminToken = loginRes.data.data.token;

    const createUploadOnlyRes = await request('POST', '/api/api-tokens', {
      token: adminToken,
      json: {
        name: '上传专用',
        permissions: ['upload:image'],
        expiresMode: 'never'
      }
    });
    assert(createUploadOnlyRes.status === 200 && createUploadOnlyRes.data.code === 0, '创建上传专用 Token 失败');
    const uploadOnlyToken = createUploadOnlyRes.data.data.plainToken;
    assert(uploadOnlyToken, '创建上传专用 Token 后未返回明文');

    const listRes = await request('GET', '/api/api-tokens', { token: adminToken });
    assert(listRes.status === 200 && listRes.data.code === 0, '获取 Token 列表失败');
    assert(Array.isArray(listRes.data.data) && listRes.data.data.length >= 1, 'Token 列表为空');
    assert(!('plainToken' in listRes.data.data[0]), 'Token 列表不应返回明文');
    assert(!('token_hash' in listRes.data.data[0]), 'Token 列表不应返回哈希');

    const uploadForm = new FormData();
    uploadForm.append('file', new Blob(['fake image'], { type: 'image/png' }), 'token-test.png');
    const uploadRes = await request('POST', '/api/upload', {
      token: uploadOnlyToken,
      formData: uploadForm
    });
    assert(uploadRes.status === 200 && uploadRes.data.code === 0, '上传专用 Token 上传失败');

    const filesDeniedRes = await request('GET', '/api/files', { token: uploadOnlyToken });
    assert(filesDeniedRes.status === 403, '缺少 files:read 权限时应拒绝访问文件列表');

    const createReadRes = await request('POST', '/api/api-tokens', {
      token: adminToken,
      json: {
        name: '上传与读取',
        permissions: ['upload:image', 'files:read'],
        expiresMode: 'custom',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    });
    assert(createReadRes.status === 200 && createReadRes.data.code === 0, '创建读取 Token 失败');
    const readToken = createReadRes.data.data.plainToken;

    const filesAllowedRes = await request('GET', '/api/files', { token: readToken });
    assert(filesAllowedRes.status === 200 && filesAllowedRes.data.code === 0, '具有 files:read 权限时应允许访问文件列表');
    const uploadedId = uploadRes.data.data.id;

    const fileDetailRes = await request('GET', `/api/files/${uploadedId}`, { token: readToken });
    assert(fileDetailRes.status === 200 && fileDetailRes.data.code === 0, '具有 files:read 权限时应允许访问文件详情');

    const deleteDeniedRes = await request('DELETE', `/api/files/${uploadedId}`, { token: readToken });
    assert(deleteDeniedRes.status === 401, 'API Token 不应允许删除文件');

    const expiredCreateRes = await request('POST', '/api/api-tokens', {
      token: adminToken,
      json: {
        name: '已过期',
        permissions: ['upload:image'],
        expiresMode: 'custom',
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
      }
    });
    assert(expiredCreateRes.status === 400, '后端应拒绝创建已过期 Token');

    console.log(JSON.stringify({
      ok: true,
      message: 'API TOKEN 功能验证通过',
      checked: [
        '管理员登录',
        '创建上传专用 Token',
        '列表不返回明文和哈希',
        '上传权限生效',
        '缺少 files:read 时拒绝列表',
        'files:read 允许列表与详情',
        'API Token 禁止删除文件',
        '拒绝创建已过期 Token'
      ]
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      message: error.message,
      logs: serverLogs
    }, null, 2));
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
