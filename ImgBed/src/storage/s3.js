const StorageProvider = require('./base');

// 注意: 需要运行 npm install @aws-sdk/client-s3 后使用，此时作为示例代码
// 因为目前还未 npm 安装 s3 sdk，这里使用动态 require 并做错误提示
let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand;
try {
    const s3 = require('@aws-sdk/client-s3');
    S3Client = s3.S3Client;
    PutObjectCommand = s3.PutObjectCommand;
    GetObjectCommand = s3.GetObjectCommand;
    DeleteObjectCommand = s3.DeleteObjectCommand;
    HeadObjectCommand = s3.HeadObjectCommand;
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
        
        let clientConfig = {
            region: config.region || 'auto',
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            }
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

    async getStream(fileId, options) {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: this._getFullPath(fileId)
        });
        const response = await this.s3.send(command);
        
        // 返回浏览器适用的流或 Buffer
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
}

module.exports = S3Storage;
