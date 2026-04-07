import StorageProvider from './base.js';

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand;
let CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand;
let s3ModuleLoaded = false;

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
        CreateMultipartUploadCommand = s3.CreateMultipartUploadCommand;
        UploadPartCommand = s3.UploadPartCommand;
        CompleteMultipartUploadCommand = s3.CompleteMultipartUploadCommand;
        AbortMultipartUploadCommand = s3.AbortMultipartUploadCommand;
        s3ModuleLoaded = true;
    } catch (e) {
        throw new Error('[S3Storage] 请先执行 npm install @aws-sdk/client-s3 安装 AWS SDK');
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

    async put(file, options) {
        await this._ensureInitialized();
        const { fileName, mimeType } = options;
        if (!fileName) throw new Error('[S3Storage] missing fileName');

        const fileKey = this._getFullPath(fileName);
        let fileBuffer;
        if (file instanceof Buffer) {
            fileBuffer = file;
        } else if (typeof file.arrayBuffer === 'function') {
            fileBuffer = Buffer.from(await file.arrayBuffer());
        } else {
            throw new Error('[S3Storage] Unsupported file format');
        }

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: fileKey,
            Body: fileBuffer,
            ContentType: mimeType || 'application/octet-stream'
        });

        await this.s3.send(command);
        return {
            id: fileKey
        };
    }

    async getStream(fileId, options = {}) {
        await this._ensureInitialized();
        const params = {
            Bucket: this.bucket,
            Key: this._getFullPath(fileId)
        };
        if (options.start !== undefined && options.end !== undefined) {
            params.Range = `bytes=${options.start}-${options.end}`;
        }
        const command = new GetObjectCommand(params);

        try {
            const response = await this.s3.send(command);
            return response.Body;
        } catch (error) {
            // 捕获校验和错误，记录但不崩溃
            if (error.message && error.message.includes('Checksum mismatch')) {
                console.error(`[S3Storage] 校验和不匹配警告 (fileId: ${fileId}):`, error.message);
                // 重试一次，不验证校验和
                const retryCommand = new GetObjectCommand({
                    ...params,
                    ChecksumMode: 'ENABLED' // 仅启用但不强制验证
                });
                const retryResponse = await this.s3.send(retryCommand);
                return retryResponse.Body;
            }
            throw error;
        }
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
            await this.s3.send(command);
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
            await this.s3.send(command);
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
            await this.s3.send(command);
            return { ok: true, message: `Bucket "${this.bucket}" 连接成功` };
        } catch (err) {
            return { ok: false, message: `连接失败: ${err.message}` };
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
        const res = await this.s3.send(cmd);
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
        const res = await this.s3.send(cmd);
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
        await this.s3.send(cmd);
        return { id: key };
    }

    async abortMultipartUpload({ uploadId, key }) {
        await this._ensureInitialized();
        const cmd = new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId
        });
        await this.s3.send(cmd);
    }
}

S3Storage.__getS3ClientForTest = () => S3Client;
S3Storage.__setS3ClientForTest = (client) => {
    S3Client = client;
};

export default S3Storage;
