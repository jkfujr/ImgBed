const StorageProvider = require('./base');
const { fetchWithProxy } = require('../network/proxy');

/**
 * Telegram API 封装类
 * 继承通用存储基类
 */
class TelegramStorage extends StorageProvider {
    constructor(config) {
        super();
        this.botToken = config.botToken;
        this.chatId = config.chatId;
        this.proxyUrl = config.proxyUrl || '';
        this.apiDomain = 'https://api.telegram.org';
        this.baseURL = `${this.apiDomain}/bot${this.botToken}`;
        this.fileDomain = this.apiDomain;
        this.defaultHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
        };
    }

    async requestTelegram(url, options = {}) {
        return fetchWithProxy(url, options, this.proxyUrl);
    }

    /**
     * 发送文件到Telegram (即原版的 sendFile)
     */
    async sendFile(file, chatId, functionName, functionType, caption = '', fileName = '') {
        const formData = new FormData();

        formData.append('chat_id', chatId);
        if (fileName) {
            formData.append(functionType, file, fileName);
        } else {
            formData.append(functionType, file);
        }
        if (caption) {
            formData.append('caption', caption);
        }

        const response = await this.requestTelegram(`${this.baseURL}/${functionName}`, {
            method: 'POST',
            headers: this.defaultHeaders,
            body: formData
        });
        console.log('[TelegramStorage] API response:', response.status, response.statusText);
        if (!response.ok) {
            throw new Error(`Telegram API error: ${response.statusText}`);
        }

        const responseData = await response.json();
        return responseData;
    }

    /**
     * 获取文件信息
     */
    getFileInfo(responseData) {
        const getFileDetails = (file) => ({
            file_id: file.file_id,
            file_name: file.file_name || file.file_unique_id,
            file_size: file.file_size,
        });

        try {
            if (!responseData.ok) {
                console.error('[TelegramStorage] API error:', responseData.description);
                return null;
            }

            if (responseData.result.photo) {
                const largestPhoto = responseData.result.photo.reduce((prev, current) =>
                    (prev.file_size > current.file_size) ? prev : current
                );
                return getFileDetails(largestPhoto);
            }

            if (responseData.result.video) {
                return getFileDetails(responseData.result.video);
            }

            if (responseData.result.audio) {
                return getFileDetails(responseData.result.audio);
            }

            if (responseData.result.document) {
                return getFileDetails(responseData.result.document);
            }

            return null;
        } catch (error) {
            console.error('[TelegramStorage] 解析响应错误:', error.message);
            return null;
        }
    }

    /**
     * 获取文件路径
     */
    async getFilePath(fileId) {
        try {
            const url = `${this.baseURL}/getFile?file_id=${fileId}`;
            const response = await this.requestTelegram(url, {
                method: 'GET',
                headers: this.defaultHeaders,
            });

            const responseData = await response.json();
            if (responseData.ok) {
                return responseData.result.file_path;
            } else {
                return null;
            }
        } catch (error) {
            console.error('[TelegramStorage] 获取文件路径失败:', error.message);
            return null;
        }
    }

    /**
     * 获取文件内容
     */
    async getFileContent(fileId) {
        const filePath = await this.getFilePath(fileId);
        if (!filePath) {
            throw new Error(`[TelegramStorage] File path not found for fileId: ${fileId}`);
        }

        const fullURL = `${this.fileDomain}/file/bot${this.botToken}/${filePath}`;
        const response = await this.requestTelegram(fullURL, {
            headers: this.defaultHeaders
        });

        return response;
    }

    // --- 以下为 StorageProvider 接口实现，映射旧逻辑 ---

    async put(file, options) {
        if (!this.chatId) throw new Error('[TelegramStorage] 缺少 chatId，无法上传');
        const { fileName, mimeType } = options;

        let fileBlob;
        if (file instanceof Buffer) {
            fileBlob = new Blob([file], { type: mimeType || 'application/octet-stream' });
        } else {
            fileBlob = file;
        }

        const responseData = await this.sendFile(
            fileBlob, this.chatId, 'sendDocument', 'document', '', fileName || 'file'
        );
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error('[TelegramStorage] 上传后未能获取 file_id');
        return { id: fileInfo.file_id };
    }

    async getStream(fileId, options) {
        // 直接复用原版拉取逻辑
        const response = await this.getFileContent(fileId);
        if (!response.ok) {
            throw new Error(`Failed to fetch from Telegram: ${response.statusText}`);
        }
        return response.body; // 返回可流通 Node 侧或者代理直接转换的 Web Stream
    }

    async getUrl(fileId, options) {
        // Telegram 不允许直接对外暴露真实带 botToken 的 URL，一般需要反代，但也属于有效 URL
        const filePath = await this.getFilePath(fileId);
        if (!filePath) return null;
        return `${this.fileDomain}/file/bot${this.botToken}/${filePath}`;
    }

    async exists(fileId) {
        const path = await this.getFilePath(fileId);
        return !!path;
    }

    /**
     * 测试连接：调用 getMe API 验证 Bot Token 有效性
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection() {
        try {
            const response = await this.requestTelegram(`${this.baseURL}/getMe`, {
                headers: this.defaultHeaders,
                signal: AbortSignal.timeout(10000)
            });
            const data = await response.json();
            if (data.ok && data.result) {
                return { ok: true, message: `Bot "${data.result.first_name}" (@${data.result.username}) 连接成功` };
            }
            return { ok: false, message: `连接失败: ${data.description || '未知错误'}` };
        } catch (err) {
            if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
                return { ok: false, message: '连接失败: 请求超时，请检查代理是否可访问 Telegram' };
            }
            if (err?.code === 'ETIMEDOUT') {
                return { ok: false, message: '连接失败: 连接 Telegram 超时，请检查代理链路' };
            }
            if (err?.code === 'ECONNREFUSED') {
                return { ok: false, message: '连接失败: 代理连接被拒绝，请检查代理地址和端口' };
            }
            if (err?.code === 'ENOTFOUND') {
                return { ok: false, message: '连接失败: 域名解析失败，请检查代理或网络配置' };
            }
            return { ok: false, message: `连接失败: ${err.message}` };
        }
    }

    // ========== 分块上传扩展 ==========

    getChunkConfig() {
        return {
            enabled: true,
            chunkThreshold: 16 * 1024 * 1024,  // 16MB 触发分块
            chunkSize: 16 * 1024 * 1024,         // 16MB/块（TG 单文件上限约 50MB，保守取 16MB）
            maxChunks: 50,
            mode: 'generic'
        };
    }

    async putChunk(chunkBuffer, options) {
        if (!this.chatId) throw new Error('[TelegramStorage] 缺少 chatId，无法上传分块');
        const { fileId, chunkIndex } = options;
        const chunkName = `${fileId}_chunk_${String(chunkIndex).padStart(4, '0')}`;
        const blob = new Blob([chunkBuffer], { type: 'application/octet-stream' });

        const responseData = await this.sendFile(
            blob, this.chatId, 'sendDocument', 'document', '', chunkName
        );
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error(`[TelegramStorage] 分块 ${chunkIndex} 上传后未能获取 file_id`);
        return { storageKey: fileInfo.file_id, size: chunkBuffer.length };
    }
}

module.exports = TelegramStorage;
