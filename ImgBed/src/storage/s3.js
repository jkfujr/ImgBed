const StorageProvider = require('./base');

// 注意: 需要运行 npm install @aws-sdk/client-s3 后使用，此时作为示例代码
// 因为目前还未 npm 安装 s3 sdk，这里使用动态 require 并做错误提示
let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand;
let CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand;
try {
    const s3 = require('@aws-sdk/client-s3');
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
} catch (e) {
    // defer throw to usage
}

/**
 * S3 兼容存储 (可用于 AWS, Cloudflare R2, MinIO 等)
 */
class S3Storage extends StorageProvider {
    constructor(config) {
        super();
        if (!S3Client) {
            throw new Error('[S3Storage] 请先执行 npm install @aws-sdk/client-s3 安裝 AWS SDK 以使用 S3 关联存储');
        }
        this.bucket = config.bucket;
        this.pathPrefix = config.pathPrefix || '';
        const pathStyle = config.pathStyle === true || config.pathStyle === 'true';

        let clientConfig = {
            region: config.region || 'auto',
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            forcePathStyle: pathStyle,
        };

        if (config.endpoint) {
            clientConfig.endpoint = config.endpoint;
        }

        this.s3 = new S3Client(clientConfig);
    }

    _getFullPath(fileName) {
        return this.pathPrefix ? `${this.pathPrefix}${fileName}` : fileName;
    }

    async put(file, options) {
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
        const params = {
            Bucket: this.bucket,
            Key: this._getFullPath(fileId)
        };
        if (options.start !== undefined && options.end !== undefined) {
            params.Range = `bytes=${options.start}-${options.end}`;
        }
        const command = new GetObjectCommand(params);
        const response = await this.s3.send(command);
        return response.Body;
    }

    async getUrl(fileId, options) {
        // 大多通过后端反代或预签名，也可返回 public R2 地址（如果有配置的话）
        return `s3://${this.bucket}/${this._getFullPath(fileId)}`;
    }

    async delete(fileId, options) {
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: this._getFullPath(fileId)
        });
        await this.s3.send(command);
        return true;
    }

    async exists(fileId) {
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

module.exports = S3Storage;
