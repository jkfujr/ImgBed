import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assertLocalization(relPath, { expected = [], forbidden = [] }) {
  const source = read(relPath);

  for (const phrase of expected) {
    assert.ok(source.includes(phrase), `${relPath} 缺少中文文案: ${phrase}`);
  }

  for (const phrase of forbidden) {
    assert.ok(!source.includes(phrase), `${relPath} 仍包含英文文案: ${phrase}`);
  }
}

function testRuntimeMessagesUseChineseText() {
  assertLocalization('ImgBed/main.js', {
    expected: [
      '已捕获可恢复的未捕获异常',
      '发生致命未捕获异常',
      '已捕获可恢复的未处理 Promise 拒绝',
      '出现未处理的 Promise 拒绝',
      '应用启动失败',
    ],
    forbidden: [
      'recoverable uncaught exception captured',
      'fatal uncaught exception',
      'recoverable unhandled rejection captured',
      'unhandled rejection',
      'application boot failed',
    ],
  });

  assertLocalization('ImgBed/src/storage/manager.js', {
    expected: ['初始化容量一致性校验失败，开始重建容量投影'],
    forbidden: ['initialize quota consistency check failed, rebuilding projection'],
  });

  assertLocalization('ImgBed/src/storage/runtime/storage-maintenance-scheduler.js', {
    expected: [
      '定时补偿重试发现待处理存储操作',
      '定时补偿重试执行失败',
      '定时容量一致性校验开始',
      '检测到容量投影漂移，开始重建',
      '定时容量维护失败',
    ],
    forbidden: [
      'scheduled compensation retry found pending operations',
      'scheduled compensation retry failed',
      'scheduled quota consistency check started',
      'quota consistency drift detected, rebuilding',
      'scheduled quota maintenance failed',
    ],
  });

  assertLocalization('ImgBed/src/storage/recovery/storage-operation-recovery.js', {
    expected: [
      '恢复扫描发现待处理的过期存储操作',
      '恢复任务超过最大重试次数，已终止',
      '恢复执行失败',
      '已恢复远端已完成状态的删除操作',
      '已恢复已提交状态的存储操作',
      '补偿执行完成',
    ],
    forbidden: [
      'recovery scan found stale storage operations',
      'recovery aborted after max retries',
      'recovery execution failed',
      'recovered remote_done delete operation',
      'recovered committed operation',
      'compensation completed',
    ],
  });

  assertLocalization('ImgBed/src/storage/runtime/storage-registry.js', {
    expected: [
      '不支持的存储类型',
      '存储实例初始化失败',
      '存储注册表已重载',
      '存储注册表重载失败',
    ],
    forbidden: [
      'unsupported storage type',
      'failed to initialize storage instance',
    ],
  });

  assertLocalization('ImgBed/src/storage/runtime/upload-selector.js', {
    expected: ['当前没有可上传的存储渠道'],
    forbidden: ['no uploadable storage channel available'],
  });

  assertLocalization('ImgBed/src/storage/base.js', {
    expected: ['未实现 put()', '未实现 get()', '未实现 putChunk()'],
    forbidden: ['Not implemented: put()', 'Not implemented: get()', 'Not implemented: putChunk()'],
  });

  assertLocalization('ImgBed/src/storage/local.js', {
    expected: ['本地存储路由的文件标识无效', '上传必须提供明确的文件 ID', '不支持的上传文件对象格式', '文件不存在', '删除文件失败'],
    forbidden: ['Invalid id for local storage routing', 'Upload requires an explicit File ID', 'Unsupported file object format for put', 'File not found', 'Failed to delete file'],
  });

  assertLocalization('ImgBed/src/storage/external.js', {
    expected: ['外部存储路由地址无效'],
    forbidden: ['Invalid URL for External routing'],
  });

  assertLocalization('ImgBed/src/storage/discord.js', {
    expected: ['Discord 接口请求失败', '响应结构无效', '触发限流，等待后重试', 'Discord 文件标识格式无效', '未找到文件访问地址', '拉取文件流失败'],
    forbidden: ['Discord API error', 'Invalid response', '429 rate limit, waiting before retry', 'Invalid Discord fileId string', 'URL not found for file', 'Failed fetching file stream'],
  });

  assertLocalization('ImgBed/src/storage/huggingface.js', {
    expected: ['文件内容类型无效', '提交请求失败', '删除请求失败', '获取文件失败', '缺少 fileName'],
    forbidden: ['Invalid file content type', 'Commit error', 'Delete error', 'Get file error', 'Missing fileName'],
  });

  assertLocalization('ImgBed/src/storage/s3.js', {
    expected: ['缺少 fileName'],
    forbidden: ['missing fileName'],
  });

  assertLocalization('ImgBed/src/storage/telegram.js', {
    expected: ['Telegram 接口请求失败', '接口返回失败', '未找到文件路径', '从 Telegram 拉取文件失败'],
    forbidden: ['Telegram API error', 'API error', 'File path not found for fileId', 'Failed to fetch from Telegram'],
  });

  assertLocalization('ImgBed/src/services/upload/execute-upload.js', {
    expected: ['上传故障切换：渠道不存在，切换', '上传故障切换：渠道上传失败', '上传故障切换：切换到备选渠道'],
    forbidden: ['Upload Failover:'],
  });

  assertLocalization('ImgBed/src/routes/upload.js', {
    expected: ['上传故障切换：文件经过切换后成功上传'],
    forbidden: ['Upload Failover:'],
  });

  console.log('  [OK] runtime-message-localization：运行时外露文案已切换为中文');
}

function main() {
  console.log('运行 runtime-message-localization 测试...');
  testRuntimeMessagesUseChineseText();
  console.log('runtime-message-localization 测试通过');
}

main();
