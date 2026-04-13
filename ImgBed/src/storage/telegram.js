import StorageProvider from './base.js';
import { fetchWithProxy } from '../network/proxy.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('telegram');

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
     * 根据文件 MIME 类型选择 Telegram 发送接口
     * 规则：
     *   GIF/WEBP  → sendAnimation
     *   SVG/ICO   → sendDocument
     *   其他图片  → sendPhoto
     */
    selectSendMethod(mimeType, fileName) {
        const lowerName = (fileName || '').toLowerCase();
        const lowerMime = (mimeType || '').toLowerCase();

        if (lowerMime === 'image/gif' || lowerMime === 'image/webp' || lowerName.endsWith('.gif') || lowerName.endsWith('.webp')) {
            return { method: 'sendAnimation', paramName: 'animation' };
        }
        if (lowerMime === 'image/svg+xml' || lowerMime === 'image/x-icon' || lowerName.endsWith('.svg') || lowerName.endsWith('.ico')) {
            return { method: 'sendDocument', paramName: 'document' };
        }
        // 默认走 sendPhoto
        return { method: 'sendPhoto', paramName: 'photo' };
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
        log.debug({ status: response.status, statusText: response.statusText }, 'API response');
        if (!response.ok) {
            throw new Error(`Telegram 接口请求失败: ${response.statusText}`);
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
                log.error({ description: responseData.description }, '接口返回失败');
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
            log.error({ err: error }, '解析响应错误');
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
            log.error({ err: error }, '获取文件路径失败');
            return null;
        }
    }

    /**
     * 获取文件内容
     */
    async getFileContent(fileId, options = {}) {
        const filePath = await this.getFilePath(fileId);
        if (!filePath) {
            throw new Error(`[TelegramStorage] 未找到文件路径: ${fileId}`);
        }

        const fullURL = `${this.fileDomain}/file/bot${this.botToken}/${filePath}`;
        const headers = { ...this.defaultHeaders };
        if (options.start !== undefined && options.end !== undefined) {
            headers.Range = `bytes=${options.start}-${options.end}`;
        }
        const response = await this.requestTelegram(fullURL, {
            headers
        });

        return response;
    }

    parseTotalSizeFromContentRange(contentRange) {
        if (!contentRange) {
            return null;
        }

        const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(contentRange);
        if (!match) {
            return null;
        }

        const totalSize = Number(match[1]);
        return Number.isFinite(totalSize) ? totalSize : null;
    }

    // --- 以下为 StorageProvider 接口实现，映射旧逻辑 ---

    async put(file, options) {
        if (!this.chatId) throw new Error('[TelegramStorage] 缺少会话标识，无法上传');
        const { fileName, mimeType } = options;

        let fileBlob;
        if (file instanceof Buffer) {
            fileBlob = new Blob([file], { type: mimeType || 'application/octet-stream' });
        } else {
            fileBlob = file;
        }

        // 根据文件类型选择发送接口
        const { method, paramName } = this.selectSendMethod(mimeType, fileName);

        const responseData = await this.sendFile(
            fileBlob, this.chatId, method, paramName, '', fileName || 'file'
        );

        if (!responseData.ok) {
            throw new Error(`[TelegramStorage] 上传失败: ${responseData.description}`);
        }

        const result = responseData.result;
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error('[TelegramStorage] 上传后未能获取文件标识');

        // 保存完整的 Telegram 消息元数据，用于后续删除
        return {
            id: fileInfo.file_id,
            fileId: fileInfo.file_id,
            messageId: result.message_id,
            chatId: this.chatId,
            method,
            size: Number(fileInfo.file_size) || undefined,
        };
    }

    async getStream(fileId, options) {
        // 直接复用原版拉取逻辑
        const response = await this.getFileContent(fileId, options);
        if (!response.ok) {
            throw new Error(`从 Telegram 拉取文件失败: ${response.statusText}`);
        }
        return response.body; // 返回可流通 Node 侧或者代理直接转换的 Web Stream
    }

    async getStreamResponse(fileId, options = {}) {
        const response = await this.getFileContent(fileId, options);
        if (!response.ok) {
            throw new Error(`从 Telegram 拉取文件失败: ${response.statusText}`);
        }

        const contentLength = Number(response.headers.get('content-length'));
        const totalSize = this.parseTotalSizeFromContentRange(response.headers.get('content-range'));
        const acceptRanges = response.headers.get('accept-ranges');

        return {
            stream: response.body,
            contentLength: Number.isFinite(contentLength) ? contentLength : null,
            totalSize,
            statusCode: response.status,
            acceptRanges: acceptRanges === 'bytes',
        };
    }

    async getUrl(fileId, options) {
        // Telegram 不允许直接对外暴露真实带 botToken 的 URL，一般需要反代，但也属于有效 URL
        const filePath = await this.getFilePath(fileId);
        if (!filePath) return null;
        return `${this.fileDomain}/file/bot${this.botToken}/${filePath}`;
    }

    /**
     * 删除 Telegram 消息（即删除该图片对应的消息）
     * options 预期包含：
     *   { messageId, chatId } — 从 storage_config.extra_result 里取出
     * 如果 options 为空或缺少 messageId，返回 false 表示不支持。
     */
    async delete(fileId, options = {}) {
        const messageId = options?.messageId;
        const chatId = options?.chatId || this.chatId;

        if (!messageId) {
            log.warn({ fileId }, 'Telegram 存储无法删除：storage_config 中缺少 messageId');
            return false;
        }

        try {
            const url = `${this.baseURL}/deleteMessage`;
            const response = await this.requestTelegram(url, {
                method: 'POST',
                headers: {
                    ...this.defaultHeaders,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId) }),
            });

            const data = await response.json();
            if (data.ok) {
                log.info({ fileId, messageId, chatId }, 'Telegram 消息删除成功');
                return true;
            } else {
                // 48h 限制等错误在这里打出来，方便排查
                log.warn({ fileId, messageId, chatId, description: data.description }, 'Telegram 删除消息失败');
                return false;
            }
        } catch (err) {
            log.error({ fileId, err }, 'Telegram 删除消息请求异常');
            return false;
        }
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
                return { ok: true, message: `机器人 "${data.result.first_name}" (@${data.result.username}) 连接成功` };
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
        if (!this.chatId) throw new Error('[TelegramStorage] 缺少会话标识，无法上传分块');
        const { fileId, chunkIndex } = options;
        const chunkName = `${fileId}_chunk_${String(chunkIndex).padStart(4, '0')}`;
        const blob = new Blob([chunkBuffer], { type: 'application/octet-stream' });

        const responseData = await this.sendFile(
            blob, this.chatId, 'sendDocument', 'document', '', chunkName
        );
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error(`[TelegramStorage] 分块 ${chunkIndex} 上传后未能获取文件标识`);
        return { storageKey: fileInfo.file_id, size: chunkBuffer.length };
    }
}

export default TelegramStorage;
