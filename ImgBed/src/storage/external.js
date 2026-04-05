import StorageProvider from './base.js';

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

    /**
     * 测试连接：HEAD 请求 baseUrl 验证网络可达性
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection() {
        if (!this.baseUrl) {
            return { ok: false, message: '未配置 baseUrl' };
        }
        try {
            const response = await fetch(this.baseUrl, {
                method: 'HEAD',
                redirect: 'follow',
                signal: AbortSignal.timeout(10000)
            });
            // 即使返回 404 也说明网络可达
            if (response.ok || response.status === 404) {
                return { ok: true, message: `网络可达: ${this.baseUrl}` };
            }
            return { ok: false, message: `连接失败: ${response.status} ${response.statusText}` };
        } catch (err) {
            return { ok: false, message: `连接失败: ${err.name === 'TimeoutError' ? '请求超时' : err.message}` };
        }
    }
}

export default ExternalStorage;
