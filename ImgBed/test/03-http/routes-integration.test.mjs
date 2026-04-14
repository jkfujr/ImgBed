import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseJsonResult,
  runIsolatedModuleScript,
} from '../helpers/isolated-module-test-helpers.mjs';

test('认证、公开配置与访客上传边界会按当前路由装配返回结果', () => {
  const script = `
    const { loadStartupConfig, readRuntimeConfig, writeRuntimeConfig } = await import('./src/config/index.js');
    const baseConfig = loadStartupConfig();
    writeRuntimeConfig({
      ...baseConfig,
      admin: {
        username: 'root',
        password: 'root-pass',
      },
      security: {
        ...baseConfig.security,
        guestUploadEnabled: false,
        uploadPassword: '',
      },
    });

    const { sqlite } = await import('./src/database/index.js');
    const { initSchema } = await import('./src/database/schema.js');
    const {
      initResponseCache,
      destroyResponseCache,
    } = await import('./src/services/cache/response-cache.js');
    const app = (await import('./src/app.js')).default;

    initSchema(sqlite);
    initResponseCache({
      enabled: baseConfig.performance?.responseCache?.enabled !== false,
      ttlSeconds: baseConfig.performance?.responseCache?.ttlSeconds || 60,
      maxKeys: baseConfig.performance?.responseCache?.maxKeys || 1000,
    });

    const server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address();
    const baseUrl = \`http://127.0.0.1:\${address.port}\`;

    async function requestJson(path, options = {}) {
      const response = await fetch(baseUrl + path, options);
      const text = await response.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {}
      return {
        status: response.status,
        body,
      };
    }

    try {
      const missingPassword = await requestJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'root' }),
      });

      const login = await requestJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'root', password: 'root-pass' }),
      });
      const token = login.body.data.token;

      const me = await requestJson('/api/auth/me', {
        headers: { Authorization: \`Bearer \${token}\` },
      });
      const changePassword = await requestJson('/api/auth/password', {
        method: 'PUT',
        headers: {
          Authorization: \`Bearer \${token}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPassword: 'root-pass-next' }),
      });
      const runtimeConfigAfterPasswordChange = readRuntimeConfig();
      const relogin = await requestJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'root', password: 'root-pass-next' }),
      });

      const guestDisabled = await requestJson('/api/public/guest-upload-config');
      const uploadDisabled = await requestJson('/api/upload', {
        method: 'POST',
      });

      const runtimeConfig = readRuntimeConfig();
      writeRuntimeConfig({
        ...runtimeConfig,
        security: {
          ...runtimeConfig.security,
          guestUploadEnabled: true,
          uploadPassword: 'guest-secret',
        },
      });

      const guestEnabled = await requestJson('/api/public/guest-upload-config');
      const wrongPassword = await requestJson('/api/upload', {
        method: 'POST',
        headers: {
          'X-Upload-Password': 'wrong-password',
        },
      });
      const noFile = await requestJson('/api/upload', {
        method: 'POST',
        headers: {
          'X-Upload-Password': 'guest-secret',
        },
      });

      console.log('JSON_RESULT ' + JSON.stringify({
        missingPassword,
        login,
        me,
        changePassword,
        runtimeConfigAfterPasswordChange,
        relogin,
        guestDisabled,
        uploadDisabled,
        guestEnabled,
        wrongPassword,
        noFile,
      }));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      destroyResponseCache();
    }
  `;

  const execution = runIsolatedModuleScript(script, {
    appRootPrefix: 'imgbed-http-auth-',
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);

  const payload = parseJsonResult(execution);

  assert.equal(payload.missingPassword.status, 400);
  assert.equal(payload.missingPassword.body.message, '用户名或密码不可为空');

  assert.equal(payload.login.status, 200);
  assert.equal(payload.login.body.data.username, 'root');
  assert.equal(payload.me.status, 200);
  assert.equal(payload.me.body.data.role, 'admin');
  assert.equal(payload.changePassword.status, 200);
  assert.equal(payload.runtimeConfigAfterPasswordChange.admin.password, undefined);
  assert.equal(typeof payload.runtimeConfigAfterPasswordChange.admin.passwordHash, 'string');
  assert.equal(payload.relogin.status, 200);
  assert.equal(payload.relogin.body.data.username, 'root');

  assert.equal(payload.guestDisabled.status, 200);
  assert.deepEqual(payload.guestDisabled.body.data, {
    guestUploadEnabled: false,
    requirePassword: false,
  });
  assert.equal(payload.uploadDisabled.status, 401);
  assert.equal(payload.uploadDisabled.body.reason, 'AUTH_GUEST_UPLOAD_DISABLED');

  assert.equal(payload.guestEnabled.status, 200);
  assert.deepEqual(payload.guestEnabled.body.data, {
    guestUploadEnabled: true,
    requirePassword: true,
  });
  assert.equal(payload.wrongPassword.status, 401);
  assert.equal(payload.wrongPassword.body.reason, 'AUTH_UPLOAD_PASSWORD_WRONG');
  assert.equal(payload.noFile.status, 400);
  assert.equal(payload.noFile.body.message, '未检测到文件上传或字段错误');
});

test('系统缓存、权限校验与 SPA 路由边界会按当前装配顺序工作', () => {
  const script = `
    const { loadStartupConfig, writeRuntimeConfig } = await import('./src/config/index.js');
    const baseConfig = loadStartupConfig();
    writeRuntimeConfig({
      ...baseConfig,
      admin: {
        username: 'admin',
        password: 'admin-pass',
      },
      storage: {
        ...baseConfig.storage,
        default: 's3-main',
        loadBalanceStrategy: 'weighted',
        loadBalanceScope: 'byType',
        loadBalanceEnabledTypes: ['s3'],
        loadBalanceWeights: {
          's3-main': 7,
        },
        failoverEnabled: true,
        storages: [
          {
            id: 's3-main',
            name: '主 S3',
            type: 's3',
            enabled: true,
            allowUpload: true,
            weight: 7,
            config: {
              endpoint: 'https://example.com',
              bucket: 'demo-bucket',
              secretAccessKey: 'secret-value',
              token: 's3-token',
              pathStyle: true,
            },
          },
        ],
      },
      performance: {
        ...baseConfig.performance,
        responseCache: {
          enabled: true,
          ttlSeconds: 60,
          maxKeys: 100,
        },
      },
    });

    const { sqlite } = await import('./src/database/index.js');
    const { initSchema } = await import('./src/database/schema.js');
    const { signToken } = await import('./src/utils/jwt.js');
    const { hashApiToken } = await import('./src/utils/apiToken.js');
    const {
      initResponseCache,
      destroyResponseCache,
    } = await import('./src/services/cache/response-cache.js');
    const { initQuotaEventsArchive } = await import('./src/services/archive/quota-events-archive.js');
    const {
      initArchiveScheduler,
      stopArchiveScheduler,
    } = await import('./src/services/archive/archive-scheduler.js');
    const app = (await import('./src/app.js')).default;

    initSchema(sqlite);
    initResponseCache({
      enabled: true,
      ttlSeconds: 60,
      maxKeys: 100,
    });
    initQuotaEventsArchive({
      enabled: true,
      retentionDays: 30,
      batchSize: 50,
      maxBatchesPerRun: 2,
    });
    initArchiveScheduler({
      enabled: false,
      scheduleHour: 3,
    });

    const now = new Date().toISOString();
    const uploadOnlyToken = 'ib_upload.only';
    const filesReadToken = 'ib_files.read';

    sqlite.prepare(\`
      INSERT INTO api_tokens (
        id, name, token_prefix, token_hash, permissions, status,
        expires_at, last_used_at, last_used_ip, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      'tok_upload_only',
      'upload-only',
      'ib_upload',
      hashApiToken(uploadOnlyToken),
      JSON.stringify(['upload:image']),
      'active',
      null,
      null,
      null,
      'admin',
      now,
      now,
    );
    sqlite.prepare(\`
      INSERT INTO api_tokens (
        id, name, token_prefix, token_hash, permissions, status,
        expires_at, last_used_at, last_used_ip, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      'tok_files_read',
      'files-read',
      'ib_files',
      hashApiToken(filesReadToken),
      JSON.stringify(['files:read']),
      'active',
      null,
      null,
      null,
      'admin',
      now,
      now,
    );

    const adminJwt = await signToken({
      role: 'admin',
      username: 'admin',
    });

    const server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address();
    const baseUrl = \`http://127.0.0.1:\${address.port}\`;

    async function requestJson(path, options = {}) {
      const response = await fetch(baseUrl + path, options);
      const text = await response.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {}
      return {
        status: response.status,
        body,
      };
    }

    try {
      const systemConfigFirst = await requestJson('/api/system/config', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const systemConfigSecond = await requestJson('/api/system/config', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const storagesResponse = await requestJson('/api/system/storages', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const loadBalanceResponse = await requestJson('/api/system/load-balance', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const quotaStatsResponse = await requestJson('/api/system/quota-stats', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const cacheStats = await requestJson('/api/system/cache/stats', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const cacheClearResponse = await requestJson('/api/system/cache/clear', {
        method: 'POST',
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const archiveStatsResponse = await requestJson('/api/system/archive/stats', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const archiveRunResponse = await requestJson('/api/system/archive/run', {
        method: 'POST',
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const archiveSchedulerResponse = await requestJson('/api/system/archive/scheduler', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const invalidTrend = await requestJson('/api/system/dashboard/upload-trend?days=8', {
        headers: { Authorization: \`Bearer \${adminJwt}\` },
      });
      const uploadOnlyFilesRead = await requestJson('/api/files?page=1&pageSize=1&directory=/', {
        headers: { Authorization: \`Bearer \${uploadOnlyToken}\` },
      });
      const filesReadMissingDirectory = await requestJson('/api/files?page=1&pageSize=1', {
        headers: { Authorization: \`Bearer \${filesReadToken}\` },
      });
      const uploadOnlyApiTokens = await requestJson('/api/api-tokens', {
        headers: { Authorization: \`Bearer \${uploadOnlyToken}\` },
      });
      const missingSpaPath = await requestJson('/login');
      const missingView = await requestJson('/0123456789ab_demo.png');
      const createDirectoryInvalid = await requestJson('/api/directories', {
        method: 'POST',
        headers: {
          Authorization: \`Bearer \${adminJwt}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const invalidStorageType = await requestJson('/api/system/storages/test', {
        method: 'POST',
        headers: {
          Authorization: \`Bearer \${adminJwt}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'unknown' }),
      });

      console.log('JSON_RESULT ' + JSON.stringify({
        systemConfigFirst,
        systemConfigSecond,
        storagesResponse,
        loadBalanceResponse,
        quotaStatsResponse,
        cacheStats,
        cacheClearResponse,
        archiveStatsResponse,
        archiveRunResponse,
        archiveSchedulerResponse,
        invalidTrend,
        uploadOnlyFilesRead,
        filesReadMissingDirectory,
        uploadOnlyApiTokens,
        missingSpaPath,
        missingView,
        createDirectoryInvalid,
        invalidStorageType,
      }));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      stopArchiveScheduler();
      destroyResponseCache();
    }
  `;

  const execution = runIsolatedModuleScript(script, {
    appRootPrefix: 'imgbed-http-routes-',
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);

  const payload = parseJsonResult(execution);

  assert.equal(payload.systemConfigFirst.status, 200);
  assert.equal(payload.systemConfigSecond.status, 200);
  assert.equal(payload.systemConfigFirst.body.data.admin.password, undefined);
  assert.equal(payload.systemConfigFirst.body.data.admin.passwordHash, undefined);
  assert.equal(payload.storagesResponse.status, 200);
  assert.equal(payload.storagesResponse.body.data.list[0].config.secretAccessKey, '***');
  assert.equal(payload.storagesResponse.body.data.list[0].config.token, '***');
  assert.equal(payload.loadBalanceResponse.status, 200);
  assert.equal(payload.loadBalanceResponse.body.data.strategy, 'weighted');
  assert.deepEqual(payload.loadBalanceResponse.body.data.enabledTypes, ['s3']);
  assert.equal(payload.quotaStatsResponse.status, 200);
  assert.equal(typeof payload.quotaStatsResponse.body.data.stats, 'object');
  assert.equal(payload.cacheStats.status, 200);
  assert.ok(payload.cacheStats.body.data.hits >= 1);
  assert.ok(payload.cacheStats.body.data.sets >= 1);
  assert.equal(payload.cacheClearResponse.status, 200);
  assert.equal(payload.cacheClearResponse.body.message, '缓存已清空');
  assert.equal(payload.archiveStatsResponse.status, 200);
  assert.equal(payload.archiveStatsResponse.body.data.enabled, true);
  assert.equal(payload.archiveRunResponse.status, 200);
  assert.equal(payload.archiveRunResponse.body.message, '归档任务执行完成');
  assert.equal(payload.archiveSchedulerResponse.status, 200);
  assert.equal(payload.archiveSchedulerResponse.body.data.enabled, false);

  assert.equal(payload.invalidTrend.status, 400);
  assert.equal(payload.invalidTrend.body.message, 'days 参数必须是 7、30 或 90');

  assert.equal(payload.uploadOnlyFilesRead.status, 403);
  assert.equal(payload.uploadOnlyFilesRead.body.message, '缺少权限：files:read');
  assert.equal(payload.filesReadMissingDirectory.status, 400);
  assert.equal(payload.filesReadMissingDirectory.body.message, '浏览文件列表时必须提供 directory 参数');

  assert.equal(payload.uploadOnlyApiTokens.status, 401);
  assert.equal(payload.uploadOnlyApiTokens.body.reason, 'AUTH_ROLE_INVALID');

  assert.equal(payload.missingSpaPath.status, 404);
  assert.equal(payload.missingSpaPath.body.message, '未找到请求的资源');

  assert.equal(payload.missingView.status, 404);
  assert.equal(payload.missingView.body.message, '文件未找到或标识符无效');

  assert.equal(payload.createDirectoryInvalid.status, 400);
  assert.equal(payload.createDirectoryInvalid.body.message, '目录名称不能为空');

  assert.equal(payload.invalidStorageType.status, 400);
  assert.equal(payload.invalidStorageType.body.message, '不支持的存储类型: unknown');
});
