import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dockerfilePath = path.resolve(currentDir, '../../Dockerfile');
const packageJsonPath = path.resolve(currentDir, '../../package.json');
const workflowPath = path.resolve(currentDir, '../../../.github/workflows/docker-publish.yml');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('Docker 运行时镜像不再重复安装 libvips，且继续保留 SQLite 运行时依赖', () => {
  const dockerfile = readFile(dockerfilePath);

  assert.match(dockerfile, /libsqlite3-0/);
  assert.doesNotMatch(dockerfile, /libvips/);
  assert.doesNotMatch(dockerfile, /COPY --from=builder \/app\/package\*\.json \.\//);
});

test('docker-publish 工作流使用 npm ci 构建前端静态资源', () => {
  const workflow = readFile(workflowPath);

  assert.match(workflow, /Build WebUI[\s\S]*npm ci/);
  assert.doesNotMatch(workflow, /Build WebUI[\s\S]*npm install/);
});

test('pino-pretty 只保留在开发依赖，避免进入生产镜像', () => {
  const packageJson = JSON.parse(readFile(packageJsonPath));

  assert.equal(packageJson.dependencies?.['pino-pretty'], undefined);
  assert.equal(packageJson.devDependencies?.['pino-pretty'], '^13.1.3');
});
