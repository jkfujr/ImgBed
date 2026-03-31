const StorageProvider = require('./base');

/**
 * Discord API 封装类
 * 继承通用存储基类
 */
class DiscordStorage extends StorageProvider {
    constructor(config) {
        super();
        this.botToken = config.botToken;
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

        console.log('[DiscordStorage] API response:', response.status, response.statusText);

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
                console.error('[DiscordStorage] Invalid response:', responseData);
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
            console.error('[DiscordStorage] Error parsing response:', error.message);
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
                    console.warn(`[DiscordStorage] 429 rate limit, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
                    
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }

                if (!response.ok) {
                    console.error('[DiscordStorage] getMessage error:', response.status, response.statusText);
                    return null;
                }

                return await response.json();
            } catch (error) {
                console.error('[DiscordStorage] Error getting message:', error.message);
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

            console.error('[DiscordStorage] deleteMessage error:', response.status, response.statusText);
            return false;
        } catch (error) {
            console.error('[DiscordStorage] Error deleting message:', error.message);
            return false;
        }
    }


    // --- 以下为 StorageProvider 接口实现 ---

    async put(file, options) {
        throw new Error('[DiscordStorage] 通用 put 上传出于重构计划策略暂不提供（建议禁用 Discord 上传以防封号）。');
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
}

module.exports = DiscordStorage;
