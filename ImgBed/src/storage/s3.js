import StorageProvider from './base.js';
import { createStoragePutResult, createStorageReadResult, parseContentRange } from './contract.js';
import { normalizeRemoteIoProcessError } from '../bootstrap/entry-error-policy.js';
import { toBuffer, toNodeReadable } from '../utils/storage-io.js';
import { runRemoteRetry } from './remote-retry.js';
import { createLogger } from '../utils/logger.js';

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand;
let ListObjectsV2Command, DeleteObjectsCommand;
let CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand;
let s3ModuleLoaded = false;
const log = createLogger('s3');

/**
 * 延迟加载 AWS SDK（仅在实例化时按需导入）
 */
async function loadS3Module() {
    if (s3ModuleLoaded) return;
    try {
        const s3 = await import('@aws-sdk/client-s3');
        S3Client = s3.S3Client;
        PutObjectCommand = s3.PutObjectCommand;
        GetObjectCommand = s3.GetObjectCommand;
        DeleteObjectCommand = s3.DeleteObjectCommand;
        HeadObjectCommand = s3.HeadObjectCommand;
        HeadBucketCommand = s3.HeadBucketCommand;
        ListObjectsV2Command = s3.ListObjectsV2Command;
        DeleteObjectsCommand = s3.DeleteObjectsCommand;
        CreateMultipartUploadCommand = s3.CreateMultipartUploadCommand;
        UploadPartCommand = s3.UploadPartCommand;
        CompleteMultipartUploadCommand = s3.CompleteMultipartUploadCommand;
        AbortMultipartUploadCommand = s3.AbortMultipartUploadCommand;
        s3ModuleLoaded = true;
    } catch (e) {
        throw new Error('[S3Storage] 请先执行 npm install @aws-sdk/client-s3 安装 S3 客户端依赖');
    }
}

/**
 * S3 兼容存储 (可用于 AWS, Cloudflare R2, MinIO 等)
 */
class S3Storage extends StorageProvider {
    constructor(config) {
        super();
        this.config = config;
        this.bucket = config.bucket;
        this.pathPrefix = config.pathPrefix || '';
        this.s3 = null;
        this._initPromise = null;
    }

    async _ensureInitialized() {
        if (this.s3) return;
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            await loadS3Module();
            const pathStyle = this.config.pathStyle === true || this.config.pathStyle === 'true';

            let clientConfig = {
                region: this.config.region || 'auto',
                credentials: {
                    accessKeyId: this.config.accessKeyId,
                    secretAccessKey: this.config.secretAccessKey,
                },
                forcePathStyle: pathStyle,
                // 禁用响应校验和验证，避免因校验和不匹配导致服务崩溃
                requestChecksumCalculation: 'WHEN_REQUIRED',
                responseChecksumValidation: 'WHEN_REQUIRED',
            };

            if (this.config.endpoint) {
                clientConfig.endpoint = this.config.endpoint;
            }

            this.s3 = new S3Client(clientConfig);
        })();

        return this._initPromise;
    }

    _getFullPath(fileName) {
        return this.pathPrefix ? `${this.pathPrefix}${fileName}` : fileName;
    }

    async sendS3Command(command, action) {
        try {
            return await this.s3.send(command);
        } catch (error) {
            throw normalizeRemoteIoProcessError(error, {
                source: `storage:s3:${action}`,
            });
        }
    }

    async resolveUploadBody(file) {
        if (Buffer.isBuffer(file) || file instanceof Uint8Array || file instanceof ArrayBuffer) {
            const buffer = await toBuffer(file);
            return { body: buffer, size: buffer.length };
        }

        if (typeof file?.stream === 'function') {
            return {
                body: toNodeReadable(file.stream()),
                size: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
            };
        }

        if (typeof file?.arrayBuffer === 'function') {
            const buffer = await toBuffer(file);
            return { body: buffer, size: buffer.length };
        }

        return { body: toNodeReadable(file), size: null };
    }

    async sendGetObject(params) {
        let useChecksumMode = false;
        return runRemoteRetry({
            execute: async () => {
                const nextParams = useChecksumMode
                    ? { ...params, ChecksumMode: 'ENABLED' }
                    : params;
                const command = new GetObjectCommand(nextParams);
                return this.sendS3Command(command, 'getObject');
            },
            shouldRetry: ({ error }, { attempt }) => {
                if (!error?.message || !error.message.includes('Checksum mismatch')) {
                    return { retry: false };
                }

                if (attempt >= 1) {
                    return { retry: false };
                }

                return {
                    retry: true,
                    delayMs: 0,
                    reason: 'checksum_mismatch',
                    beforeRetry: async () => {
                        useChecksumMode = true;
                    },
                };
            },
            maxRetries: 1,
            maxTotalDelayMs: 0,
            logger: log,
            logContext: { key: params.Key, bucket: params.Bucket },
            logMessage: 'S3 读取对象因校验和不匹配重试',
        });
    }

    async put(file, options) {
        await this._ensureInitialized();
        const { fileName, mimeType, contentLength } = options;
        if (!fileName) throw new Error('[S3Storage] 缺少 fileName');

        const fileKey = this._getFullPath(fileName);
        const { body, size } = await this.resolveUploadBody(file);
        const resolvedContentLength = contentLength ?? size ?? undefined;

        const commandParams = {
            Bucket: this.bucket,
            Key: fileKey,
            Body: body,
            ContentType: mimeType || 'application/octet-stream'
        };
        // 流式上传时需提供 ContentLength，否则 S3 SDK 可能报错
        if (resolvedContentLength !== undefined) {
            commandParams.ContentLength = resolvedContentLength;
        }

        const command = new PutObjectCommand(commandParams);
        await this.sendS3Command(command, 'putObject');
        return createStoragePutResult({
            storageKey: fileKey,
            size: resolvedContentLength ?? null,
        });
    }

    async getStreamResponse(fileId, options = {}) {
        await this._ensureInitialized();
        const params = {
            Bucket: this.bucket,
            Key: this._getFullPath(fileId)
        };
        if (options.start !== undefined && options.end !== undefined) {
            params.Range = `bytes=${options.start}-${options.end}`;
        }

        const response = await this.sendGetObject(params);
        const contentRange = parseContentRange(response.ContentRange);

        return createStorageReadResult({
            stream: response.Body,
            contentLength: response.ContentLength ?? null,
            totalSize: contentRange?.totalSize ?? response.ContentLength ?? null,
            statusCode: response.$metadata?.httpStatusCode,
            acceptRanges: true,
        });
    }

    async getUrl(fileId, options) {
        // 大多通过后端反代或预签名，也可返回 public R2 地址（如果有配置的话）
        return `s3://${this.bucket}/${this._getFullPath(fileId)}`;
    }

    async delete(fileId, options) {
        try {
            await this._ensureInitialized();
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: this._getFullPath(fileId)
            });
            await this.sendS3Command(command, 'deleteObject');
            return true;
        } catch (err) {
            // S3 删除失败时捕获异常并返回 false
            return false;
        }
    }

    async exists(fileId) {
        await this._ensureInitialized();
        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucket,
                Key: this._getFullPath(fileId)
            });
            await this.sendS3Command(command, 'headObject');
            return true;
        } catch (error) {
            if (error.name === 'NotFound') {
                return false;
            }
            throw error;
        }
    }

    /**
     * 测试连接：使用 HeadBucketCommand 检查 bucket 是否存在且可访问
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection() {
        await this._ensureInitialized();
        try {
            const command = new HeadBucketCommand({ Bucket: this.bucket });
            await this.sendS3Command(command, 'headBucket');
            return { ok: true, message: `存储桶 "${this.bucket}" 连接成功` };
        } catch (err) {
            let message = err.message;

            if (message.includes('Region not accepted')) {
                message = 'Region 配置错误：请勿在 Region 字段填写完整 URL。\n\n' +
                          '正确配置示例：\n' +
                          '【AWS S3】Region: us-east-1 | Endpoint: 留空\n' +
                          '【Cloudflare R2】Region: auto | Endpoint: https://账户ID.r2.cloudflarestorage.com\n' +
                          '【MinIO】Region: auto | Endpoint: http://localhost:9000';
            } else if (message.includes('getaddrinfo ENOTFOUND')) {
                message = 'Endpoint 配置错误：无法解析域名，请检查 Endpoint 格式是否正确';
            } else if (err.name === 'NoSuchBucket') {
                message = `存储桶 "${this.bucket}" 不存在或无权访问，请检查 Bucket 名称和访问密钥`;
            } else if (err.name === 'InvalidAccessKeyId') {
                message = 'Access Key ID 无效，请检查访问密钥配置';
            } else if (err.name === 'SignatureDoesNotMatch') {
                message = 'Secret Access Key 错误，请检查访问密钥配置';
            } else {
                message = `连接失败: ${message}`;
            }

            return { ok: false, message };
        }
    }

    async hasExistingObjects() {
        await this._ensureInitialized();
        const command = new ListObjectsV2Command({
            Bucket: this.bucket,
            MaxKeys: 1,
        });
        const response = await this.sendS3Command(command, 'listObjectsV2');
        return Number(response?.KeyCount || 0) > 0 || (response?.Contents || []).length > 0;
    }

    async clearBucketContents() {
        await this._ensureInitialized();
        let deletedCount = 0;
        const startTime = Date.now();
        const timeoutMs = 300000; // 5 分钟超时
        let continuationToken = null;

        while (true) {
            // 检查超时
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`清空操作超时（已删除 ${deletedCount} 个对象）`);
            }

            // 不使用 Delimiter，列出所有对象（包括目录对象）
            const listCommand = new ListObjectsV2Command({
                Bucket: this.bucket,
                MaxKeys: 1000, // 增加批次大小
                ContinuationToken: continuationToken, // 使用续传令牌
            });
            const response = await this.sendS3Command(listCommand, 'listObjectsV2');

            // 收集所有对象（包括文件和目录对象）
            // 目录对象通常以 '/' 结尾，如 'pixiv/', 'QQ/'
            const objects = (response?.Contents || [])
                .map((item) => item?.Key)
                .filter(Boolean)
                .map((key) => ({ Key: key }));

            if (objects.length === 0) {
                log.info({ deletedCount }, 'S3 清空完成');
                return { deletedCount };
            }

            // 分批删除，避免单次请求过大
            const batchSize = 1000; // S3 DeleteObjects 最大支持 1000
            for (let i = 0; i < objects.length; i += batchSize) {
                const batch = objects.slice(i, i + batchSize);
                const deleteCommand = new DeleteObjectsCommand({
                    Bucket: this.bucket,
                    Delete: {
                        Objects: batch,
                        Quiet: true,
                    },
                });
                await this.sendS3Command(deleteCommand, 'deleteObjects');
                deletedCount += batch.length;
                log.info({ deletedCount, batchSize: batch.length }, 'S3 清空进度');
            }

            // 检查是否还有更多对象
            if (response?.IsTruncated) {
                continuationToken = response.NextContinuationToken;
            } else {
                // 没有更多对象了，重新从头开始检查（确保删除干净）
                continuationToken = null;
                // 再次列出，如果为空则完成
                const checkCommand = new ListObjectsV2Command({
                    Bucket: this.bucket,
                    MaxKeys: 1,
                });
                const checkResponse = await this.sendS3Command(checkCommand, 'listObjectsV2');
                if ((checkResponse?.Contents || []).length === 0) {
                    log.info({ deletedCount }, 'S3 清空完成');
                    return { deletedCount };
                }
            }
        }
    }

    // ========== 分块上传扩展 ==========

    getChunkConfig() {
        return {
            enabled: true,
            chunkThreshold: 100 * 1024 * 1024,  // 100MB 触发
            chunkSize: 50 * 1024 * 1024,          // 50MB/块
            maxChunks: 10000,
            mode: 'native'                         // S3 原生 multipart
        };
    }

    async initMultipartUpload({ fileName, mimeType }) {
        await this._ensureInitialized();
        const key = this._getFullPath(fileName);
        const cmd = new CreateMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: mimeType || 'application/octet-stream'
        });
        const res = await this.sendS3Command(cmd, 'initMultipartUpload');
        return { uploadId: res.UploadId, key };
    }

    async uploadPart(chunkBuffer, { uploadId, key, partNumber }) {
        await this._ensureInitialized();
        const cmd = new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: chunkBuffer
        });
        const res = await this.sendS3Command(cmd, 'uploadPart');
        return { partNumber, etag: res.ETag };
    }

    async completeMultipartUpload({ uploadId, key, parts }) {
        await this._ensureInitialized();
        const cmd = new CompleteMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
                Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag }))
            }
        });
        await this.sendS3Command(cmd, 'completeMultipartUpload');
        return createStoragePutResult({
            storageKey: key,
        });
    }

    async abortMultipartUpload({ uploadId, key }) {
        await this._ensureInitialized();
        const cmd = new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId
        });
        await this.sendS3Command(cmd, 'abortMultipartUpload');
    }
}

S3Storage.__getS3ClientForTest = () => S3Client;
S3Storage.__setS3ClientForTest = (client) => {
    S3Client = client;
};
// 测试用：注入命令构造函数 stub（避免依赖真实 AWS SDK）
S3Storage.__setCommandsForTest = (commands) => {
    if (commands.PutObjectCommand !== undefined) PutObjectCommand = commands.PutObjectCommand;
    if (commands.GetObjectCommand !== undefined) GetObjectCommand = commands.GetObjectCommand;
    if (commands.DeleteObjectCommand !== undefined) DeleteObjectCommand = commands.DeleteObjectCommand;
    if (commands.HeadObjectCommand !== undefined) HeadObjectCommand = commands.HeadObjectCommand;
    if (commands.ListObjectsV2Command !== undefined) ListObjectsV2Command = commands.ListObjectsV2Command;
    if (commands.DeleteObjectsCommand !== undefined) DeleteObjectsCommand = commands.DeleteObjectsCommand;
};

export default S3Storage;
