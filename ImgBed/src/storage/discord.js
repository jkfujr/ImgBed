import StorageProvider from './base.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('discord');

/**
 * Discord API 封装类
 * 继承通用存储基类
 */
class DiscordStorage extends StorageProvider {
    constructor(config) {
        super();
        this.botToken = config.botToken;
        this.channelId = config.channelId;
        this.baseURL = 'https://discord.com/api/v10';
        this.defaultHeaders = {
            'Authorization': `Bot ${this.botToken}`,
            'User-Agent': 'DiscordBot (ImgBed-Node, 1.0)'
        };
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

        const response = await fetch(`${this.baseURL}/channels/${channelId}/messages`, {
            method: 'POST',
            headers: this.defaultHeaders,
            body: formData
        });

        log.debug({ status: response.status, statusText: response.statusText }, 'API response');

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`);
        }

        return await response.json();
    }

    /**
     * 从响应中提取文件信息
     */
    getFileInfo(responseData) {
        try {
            if (!responseData || !responseData.id) {
                log.error({ responseData }, 'Invalid response');
                return null;
            }

            if (responseData.attachments && responseData.attachments.length > 0) {
                const attachment = responseData.attachments[0];
                return {
                    message_id: responseData.id,
                    attachment_id: attachment.id,
                    file_name: attachment.filename,
                    file_size: attachment.size,
                    content_type: attachment.content_type,
                    url: attachment.url,
                    proxy_url: attachment.proxy_url
                };
            }

            return null;
        } catch (error) {
            log.error({ err: error }, 'Error parsing response');
            return null;
        }
    }

    /**
     * 获取消息信息（用于获取文件 URL）
     */
    async getMessage(channelId, messageId, maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(`${this.baseURL}/channels/${channelId}/messages/${messageId}`, {
                    method: 'GET',
                    headers: this.defaultHeaders
                });

                // 429 速率限制：等待后重试
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitTime = retryAfter ? parseFloat(retryAfter) * 1000 : 1000 * (attempt + 1);
                    log.warn({ waitTime, attempt: attempt + 1, maxRetries }, '429 rate limit, waiting before retry');

                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }

                if (!response.ok) {
                    log.error({ status: response.status, statusText: response.statusText }, 'getMessage error');
                    return null;
                }

                return await response.json();
            } catch (error) {
                log.error({ err: error }, 'Error getting message');
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
            const response = await fetch(`${this.baseURL}/channels/${channelId}/messages/${messageId}`, {
                method: 'DELETE',
                headers: this.defaultHeaders
            });

            if (response.status === 204 || response.ok) {
                return true;
            }

            log.error({ status: response.status, statusText: response.statusText }, 'deleteMessage error');
            return false;
        } catch (error) {
            log.error({ err: error }, 'Error deleting message');
            return false;
        }
    }


    // --- 以下为 StorageProvider 接口实现 ---

    async put(file, options) {
        if (!this.channelId) throw new Error('[DiscordStorage] 缺少 channelId，无法上传');
        const { fileName, mimeType } = options;

        let fileBlob;
        if (file instanceof Buffer) {
            fileBlob = new Blob([file], { type: mimeType || 'application/octet-stream' });
        } else {
            fileBlob = file;
        }

        const responseData = await this.sendFile(fileBlob, this.channelId, fileName || 'file');
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error('[DiscordStorage] 上传后未能获取消息 ID');
        return { id: `${this.channelId}/${fileInfo.message_id}` };
    }

    async getStream(fileId, options) {
        // 配置里会有 channelId 或者参数传过来，通常 fileId = channelId/messageId
        const [channelId, messageId] = fileId.split('/');
        if (!channelId || !messageId) {
            throw new Error('[DiscordStorage] Invalid Discord fileId string. Expected "channelId/messageId".');
        }

        const fileURL = await this.getFileURL(channelId, messageId);
        if (!fileURL) {
            throw new Error(`[DiscordStorage] URL not found for file: ${fileId}`);
        }

        const response = await fetch(fileURL);
        if (!response.ok) throw new Error('[DiscordStorage] Failed fetching file stream: ' + response.statusText);
        return response.body; 
    }

    async getUrl(fileId, options) {
        const [channelId, messageId] = fileId.split('/');
        if (!channelId || !messageId) return null;
        return await this.getFileURL(channelId, messageId);
    }

    async delete(fileId, options) {
        const [channelId, messageId] = fileId.split('/');
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
            const response = await fetch(`${this.baseURL}/users/@me`, {
                headers: this.defaultHeaders,
                signal: AbortSignal.timeout(10000)
            });
            if (response.ok) {
                const data = await response.json();
                return { ok: true, message: `Bot "${data.username}" 连接成功` };
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
        if (!this.channelId) throw new Error('[DiscordStorage] 缺少 channelId，无法上传分块');
        const { fileId, chunkIndex } = options;
        const chunkName = `${fileId}_chunk_${String(chunkIndex).padStart(4, '0')}`;
        const blob = new Blob([chunkBuffer], { type: 'application/octet-stream' });

        const responseData = await this.sendFile(blob, this.channelId, chunkName);
        const fileInfo = this.getFileInfo(responseData);
        if (!fileInfo) throw new Error(`[DiscordStorage] 分块 ${chunkIndex} 上传后未能获取消息 ID`);
        return { storageKey: `${this.channelId}/${fileInfo.message_id}`, size: chunkBuffer.length };
    }
}

export default DiscordStorage;
