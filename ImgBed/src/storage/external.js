const StorageProvider = require('./base');

/**
 * 外部代理 (External) 存储渠道实现
 * 用于兼容将之前配置的外链/反向代理作为图床渠道的遗留数据
 */
class ExternalStorage extends StorageProvider {
    constructor(config) {
        super();
        this.baseUrl = config.baseUrl;
        if (!this.baseUrl) {
             console.warn('[ExternalStorage] 未配置 baseUrl。');
        }
        // 确保baseUrl斜杠结尾标准一致
        if (this.baseUrl && !this.baseUrl.endsWith('/')) {
            this.baseUrl += '/';
        }
    }

    async put(file, options) {
        throw new Error('[ExternalStorage] 此渠道为纯粹访问映射，不支持新文件上传。');
    }

    async getStream(fileId, options) {
        const url = await this.getUrl(fileId);
        if (!url) throw new Error('[ExternalStorage] Invalid URL for External routing');
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`[ExternalStorage] 请求外部文件失败: ${response.status} ${response.statusText}`);
        }
        return response.body;
    }

    async getUrl(fileId, options) {
        return this.baseUrl ? `${this.baseUrl}${fileId}` : null;
    }

    async delete(fileId, options) {
        // 反代资源一般无权远程删除，这里默认标记为 false 或直接成功
        return false;
    }

    async exists(fileId) {
        const url = await this.getUrl(fileId);
        if (!url) return false;
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return response.ok;
        } catch(e) {
            return false;
        }
    }
}

module.exports = ExternalStorage;
