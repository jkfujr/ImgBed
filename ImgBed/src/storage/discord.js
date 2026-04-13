import StorageProvider from './base.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithProxy } from '../network/proxy.js';
import { toBlob } from '../utils/storage-io.js';
import { createStorageChunkPutResult, createStoragePutResult, createStorageReadResultFromResponse } from './contract.js';

const log = createLogger('discord');

/**
     * Discord API 封装类
     * 实现 StorageProvider 统一接口
     */
class DiscordStorage extends StorageProvider {
    constructor(config) {
        super();
        this.botToken = config.botToken;
        this.channelId = config.channelId;
        this.proxyUrl = config.proxyUrl || '';
        this.baseURL = 'https://discord.com/api/v10';
        this.defaultHeaders = {
            'Authorization': `Bot ${this.botToken}`,
            'User-Agent': 'DiscordBot (ImgBed-Node, 1.0)'
        };
    }

    async requestDiscord(url, options = {}) {
        return fetchWithProxy(url, options, this.proxyUrl);
    }

    /**
     * 发送文件到 Discord 频道
     */
    async sendFile(file, channelId, fileName = '') {
        const formData = new FormData();
        
        // Discord 使用 files[0] 作为文件字段名
        if (fileName) {
            formData.append('files[0]', file, fileName);
        } else {
            formData.append('files[0]', file);
        }

        const response = await this.requestDiscord(`${this.baseURL}/channels/${channelId}/messages`, {
            method: 'POST',
            headers: this.defaultHeaders,
            body: formData
        });

        log.debug({ status: response.status, statusText: response.statusText }, 'API response');

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Discord 接口请求失败: ${response.status} - ${errorData.message || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * 从响应中提取文件信息
     */
    getFileInfo(responseData) {
        try {
            if (!responseData || !responseData.id) {
                log.error({ responseData }, '响应结构无效');
                return null;
            }

            if (responseData.attachments && responseData.attachments.length > 0) {
                const attachment = responseData.attachments[0];
                return {
                    messageId: responseData.id,
                    attachmentId: attachment.id,
                    fileName: attachment.filename,
                    fileSize: attachment.size,
                    contentType: attachment.content_type,
                    url: attachment.url,
                    proxyUrl: attachment.proxy_url
                };
            }

            return null;
        } catch (error) {
            log.error({ err: error }, '解析响应失败');
            return null;
        }
    }

    /**
     * 获取消息信息（用于获取文件 URL）
     */
    async getMessage(channelId, messageId, maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.requestDiscord(`${this.baseURL}/channels/${channelId}/messages/${messageId}`, {
                    method: 'GET',
                    headers: this.defaultHeaders
                });

                // 429 速率限制：等待后重试
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseFloat(retryAfter) * 1000 : 1000 * (attempt + 1);
                    log.warn({ waitTime, attempt: attempt + 1, maxRetries }, '触发限流，等待后重试');

                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }

                if (!response.ok) {
                    log.error({ status: response.status, statusText: response.statusText }, '获取消息失败');
                    return null;
                }

                return await response.json();
            } catch (error) {
                log.error({ err: error }, '读取消息失败');
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
                    continue;
                }
                return null;
            }
        }
        return null;
    }

    /**
     * 获取文件 URL
     */
    async getFileURL(channelId, messageId) {
        const message = await this.getMessage(channelId, messageId);
        
        if (message && message.attachments && message.attachments.length > 0) {
            return message.attachments[0].url;
        }

        return null;
    }

    /**
     * 删除消息（用于删除文件）
     */
    async deleteMessage(channelId, messageId) {
        try {
            const response = await this.requestDiscord(`${this.baseURL}/channels/${channelId}/messages/${messageId}`, {
                method: 'DELETE',
                headers: this.defaultHeaders
            });

            if (response.status === 204 || response.ok) {
                return true;
            }

            if (response.status === 404) {
                return true;
            }

            log.error({ status: response.status, statusText: response.statusText }, '删除消息失败');
            return false;
        } catch (error) {
            log.error({ err: error }, '删除消息请求异常');
            return false;
        }
    }


    // --- 以下为 StorageProvider 接口实现 ---

    async put(file, options) {
        if (!this.channelId) throw new Error('[DiscordStorage] 缺少频道标识，无法上传');
        const { fileName, mimeType } = options;
        const fileBlob = toBlob(file, mimeType || 'application/octet-stream');

        const responseData = await this.sendFile(fileBlob, this.channelId, fileName || 'file');
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error('[DiscordStorage] 上传后未能获取消息 ID');
        return createStoragePutResult({
            storageKey: `${this.channelId}/${fileInfo.messageId}`,
            size: Number(fileInfo.fileSize) || null,
            deleteToken: {
                channelId: this.channelId,
                messageId: fileInfo.messageId,
            },
        });
    }

    async getStreamResponse(fileId, options = {}) {
        const [channelId, messageId] = fileId.split('/');
        if (!channelId || !messageId) {
            throw new Error('[DiscordStorage] Discord 文件标识格式无效，应为“频道标识/消息标识”');
        }

        const fileURL = await this.getFileURL(channelId, messageId);
        if (!fileURL) {
            throw new Error(`[DiscordStorage] 未找到文件访问地址: ${fileId}`);
        }

        const headers = {};
        if (options.start !== undefined && options.end !== undefined) {
            headers.Range = `bytes=${options.start}-${options.end}`;
        }

        const response = await this.requestDiscord(fileURL, { headers });
        if (!response.ok) throw new Error('[DiscordStorage] 拉取文件流失败: ' + response.statusText);
        return createStorageReadResultFromResponse(response);
    }

    async getUrl(fileId, options) {
        const [channelId, messageId] = fileId.split('/');
        if (!channelId || !messageId) return null;
        return await this.getFileURL(channelId, messageId);
    }

    async delete(fileId, options) {
        const [storageChannelId, storageMessageId] = String(fileId || '').split('/');
        const channelId = options?.channelId || storageChannelId;
        const messageId = options?.messageId || storageMessageId;
        if (!channelId || !messageId) return false;
        return await this.deleteMessage(channelId, messageId);
    }

    async exists(fileId) {
        const [channelId, messageId] = fileId.split('/');
        if (!channelId || !messageId) return false;
        const msg = await this.getMessage(channelId, messageId);
        return !!msg;
    }

    /**
     * 测试连接：调用 /users/@me 验证 Bot Token 有效性
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection() {
        try {
            const response = await this.requestDiscord(`${this.baseURL}/users/@me`, {
                headers: this.defaultHeaders,
                signal: AbortSignal.timeout(10000)
            });
            if (response.ok) {
                const data = await response.json();
                return { ok: true, message: `机器人 "${data.username}" 连接成功` };
            }
            const errData = await response.json().catch(() => ({}));
            return { ok: false, message: `连接失败: ${response.status} - ${errData.message || response.statusText}` };
        } catch (err) {
            return { ok: false, message: `连接失败: ${err.name === 'TimeoutError' ? '请求超时' : err.message}` };
        }
    }

    // ========== 分块上传扩展 ==========

    getChunkConfig() {
        return {
            enabled: true,
            chunkThreshold: 20 * 1024 * 1024,  // 20MB 触发分块
            chunkSize: 20 * 1024 * 1024,         // 20MB/块（Discord Nitro 上限 500MB，基础上限约 25MB）
            maxChunks: 50,
            mode: 'generic'
        };
    }

    async putChunk(chunkBuffer, options) {
        if (!this.channelId) throw new Error('[DiscordStorage] 缺少频道标识，无法上传分块');
        const { fileId, chunkIndex } = options;
        const chunkName = `${fileId}_chunk_${String(chunkIndex).padStart(4, '0')}`;
        const blob = toBlob(chunkBuffer, 'application/octet-stream');

        const responseData = await this.sendFile(blob, this.channelId, chunkName);
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error(`[DiscordStorage] 分块 ${chunkIndex} 上传后未能获取消息 ID`);
        return createStorageChunkPutResult({
            storageKey: `${this.channelId}/${fileInfo.messageId}`,
            size: Number(fileInfo.fileSize) || chunkBuffer.length,
            deleteToken: {
                channelId: this.channelId,
                messageId: fileInfo.messageId,
            },
        });
    }
}

export default DiscordStorage;
