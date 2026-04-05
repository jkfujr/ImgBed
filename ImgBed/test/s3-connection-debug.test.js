const { S3Client, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const assert = require('node:assert/strict');

const config = {
  bucket: process.env.S3_DEBUG_BUCKET || '',
  region: process.env.S3_DEBUG_REGION || '',
  accessKeyId: process.env.S3_DEBUG_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.S3_DEBUG_SECRET_ACCESS_KEY || '',
  endpoint: process.env.S3_DEBUG_ENDPOINT || '',
  pathStyle: process.env.S3_DEBUG_PATH_STYLE === 'true',
};

function assertRequiredEnv() {
  const missing = [];
  if (!config.bucket) missing.push('S3_DEBUG_BUCKET');
  if (!config.region) missing.push('S3_DEBUG_REGION');
  if (!config.accessKeyId) missing.push('S3_DEBUG_ACCESS_KEY_ID');
  if (!config.secretAccessKey) missing.push('S3_DEBUG_SECRET_ACCESS_KEY');
  if (!config.endpoint) missing.push('S3_DEBUG_ENDPOINT');

  if (missing.length) {
    throw new Error(`缺少调试环境变量: ${missing.join(', ')}`);
  }
}

function maskValue(value, visibleStart = 3, visibleEnd = 2) {
  if (!value) {
    return '';
  }
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, visibleStart)}***${value.slice(-visibleEnd)}`;
}

function createClient() {
  return new S3Client({
    region: config.region || 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.pathStyle === true,
  });
}

function printError(title, error) {
  console.log(`\n[${title}] 失败`);
  console.log('name:', error?.name);
  console.log('message:', error?.message);
  console.log('Code:', error?.Code);
  console.log('status:', error?.$metadata?.httpStatusCode);
  console.log('requestId:', error?.$metadata?.requestId);
  console.log('extendedRequestId:', error?.$metadata?.extendedRequestId);
  console.log('cfId:', error?.$metadata?.cfId);
  console.log('fault:', error?.$fault);
  if (error?.cause) {
    console.log('cause.name:', error.cause?.name);
    console.log('cause.message:', error.cause?.message);
    console.log('cause.code:', error.cause?.code);
    console.log('cause.errno:', error.cause?.errno);
  }
  if (error?.stack) {
    console.log('stack:', error.stack);
  }
}

async function runStep(title, fn) {
  try {
    const result = await fn();
    console.log(`\n[${title}] 成功`);
    if (result !== undefined) {
      console.log(result);
    }
    return { ok: true, result };
  } catch (error) {
    printError(title, error);
    return { ok: false, error };
  }
}

async function main() {
  assertRequiredEnv();

  const client = createClient();
  const testKey = `claude-debug-${Date.now()}.txt`;

  console.log('使用配置:');
  console.log(JSON.stringify({
    bucket: config.bucket,
    region: config.region,
    accessKeyId: maskValue(config.accessKeyId, 4, 2),
    secretAccessKey: maskValue(config.secretAccessKey, 3, 2),
    endpoint: config.endpoint,
    pathStyle: config.pathStyle,
  }, null, 2));

  const headBucket = await runStep('HeadBucket', async () => {
    const response = await client.send(new HeadBucketCommand({
      Bucket: config.bucket,
    }));
    return {
      statusCode: response?.$metadata?.httpStatusCode,
      requestId: response?.$metadata?.requestId,
    };
  });

  const listObjects = await runStep('ListObjectsV2(MaxKeys=1)', async () => {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      MaxKeys: 1,
    }));
    return {
      statusCode: response?.$metadata?.httpStatusCode,
      keyCount: response?.KeyCount,
      contents: (response?.Contents || []).map((item) => item.Key),
      requestId: response?.$metadata?.requestId,
    };
  });

  const putObject = await runStep('PutObject/DeleteObject 临时写入测试', async () => {
    const body = Buffer.from('claude s3 connection debug');
    const putResponse = await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
      Body: body,
      ContentType: 'text/plain',
    }));

    const deleteResponse = await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: testKey,
    }));

    return {
      putStatusCode: putResponse?.$metadata?.httpStatusCode,
      deleteStatusCode: deleteResponse?.$metadata?.httpStatusCode,
      key: testKey,
      putRequestId: putResponse?.$metadata?.requestId,
      deleteRequestId: deleteResponse?.$metadata?.requestId,
    };
  });

  assert.equal(headBucket.ok || listObjects.ok || putObject.ok, true, '至少应有一个操作成功');
}

main().catch((error) => {
  printError('脚本执行', error);
  process.exit(1);
});
