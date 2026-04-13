import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('F:/Code/code/0x10_fork/ImgBed');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function testStartupLogMessagesUseReadableChineseText() {
  const databaseSource = read('ImgBed/src/database/index.js');
  const schemaSource = read('ImgBed/src/database/schema.js');
  const migrateSource = read('ImgBed/src/database/migrate.js');
  const responseCacheSource = read('ImgBed/src/services/cache/response-cache.js');
  const archiveSource = read('ImgBed/src/services/archive/quota-events-archive.js');
  const schedulerSource = read('ImgBed/src/services/archive/archive-scheduler.js');
  const runtimeSource = read('ImgBed/src/bootstrap/application-runtime.js');
  const registrySource = read('ImgBed/src/storage/runtime/storage-registry.js');
  const quotaSource = read('ImgBed/src/storage/quota/quota-projection-service.js');
  const configLoaderSource = read('ImgBed/src/config/config-loader.js');

  assert.match(databaseSource, /(数据库连接已建立|鏁版嵁搴撹繛鎺ュ凡寤虹珛)/);
  assert.match(schemaSource, /(数据库表结构初始化完成|鏁版嵁搴撹〃缁撴瀯鍒濆鍖栧畬鎴)/);
  assert.match(migrateSource, /(数据库结构已登记为 v0|鏁版嵁搴撶粨鏋勫凡鐧昏涓簙0)/);
  assert.match(responseCacheSource, /(响应缓存服务已初始化|鍝嶅簲缂撳瓨鏈嶅姟宸插垵濮嬪寲)/);
  assert.match(archiveSource, /(容量事件归档服务已初始化|瀹归噺浜嬩欢褰掓。鏈嶅姟宸插垵濮嬪寲)/);
  assert.match(schedulerSource, /(归档调度器已启动|褰掓。璋冨害鍣ㄥ凡鍚姩)/);
  assert.match(schedulerSource, /(下次归档任务已调度|涓嬫褰掓。浠诲姟宸茶皟搴)/);
  assert.match(runtimeSource, /(存储渠道已同步到数据库|瀛樺偍娓犻亾宸插悓姝ュ埌鏁版嵁搴)/);
  assert.match(runtimeSource, /(正在启动服务，地址: http:\/\/|姝ｅ湪鍚姩鏈嶅姟锛屽湴鍧€: http:\/\/)/);
  assert.match(runtimeSource, /(服务已启动，监听地址: http:\/\/|鏈嶅姟宸插惎鍔紝鐩戝惉鍦板潃: http:\/\/)/);
  assert.match(registrySource, /(存储注册表已重载|瀛樺偍娉ㄥ唽琛ㄥ凡閲嶈浇)/);
  assert.match(quotaSource, /(已从缓存加载容量投影|宸蹭粠缂撳瓨鍔犺浇瀹归噺鎶曞奖)/);
  assert.match(quotaSource, /(容量投影一致性校验通过|瀹归噺鎶曞奖涓€鑷存€ф牎楠岄€氳繃)/);
  assert.match(configLoaderSource, /未找到 config\.json，已自动创建默认配置/);
  assert.match(configLoaderSource, /已为默认配置生成新的 JWT 密钥/);
  assert.match(configLoaderSource, /config\.json 格式非法，已备份原文件，请修复后重新启动服务/);
  console.log('  [OK] startup logs：关键启动链路已使用正常中文文案');
}

function main() {
  console.log('运行 startup-log-encoding 测试...');
  testStartupLogMessagesUseReadableChineseText();
  console.log('startup-log-encoding 测试通过');
}

main();
