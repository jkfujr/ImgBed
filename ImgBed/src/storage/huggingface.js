import StorageProvider from './base.js';

/**
 * HuggingFace API 封装类
 * 继承通用存储基类
 */
class HuggingFaceStorage extends StorageProvider {
    constructor(config) {
        super();
        this.token = config.token;
        this.repo = config.repo;
        this.baseURL = `https://huggingface.co/api/datasets/${this.repo}`;
        this.defaultHeaders = {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * 构建提交的文件列表
     */
    async buildCommitFiles(filesData) {
        const operations = [];

        // 处理文件数组
        for (const [path, data] of Object.entries(filesData)) {
            let content;
            if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
                // 如果是二进制内容，转换为 base64
                const bytes = new Uint8Array(data);
                content = Buffer.from(bytes).toString('base64');
                
                operations.push({
                    operation: "add",
                    path: path,
                    content: content,
                    encoding: "base64"
                });
            } else {
                return null;
            }
        }
        return operations;
    }

    /**
     * 提交修改到 HuggingFace
     */
    async commit(commitMessage, filesData) {
        try {
            const operations = await this.buildCommitFiles(filesData);
            if (!operations) {
                throw new Error("Invalid file content type");
            }

            const commitData = {
                operations: operations,
                commit_message: commitMessage
            };

            const response = await fetch(`${this.baseURL}/commit/main`, {
                method: 'POST',
                headers: this.defaultHeaders,
                body: JSON.stringify(commitData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`[HuggingFaceStorage] API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[HuggingFaceStorage] Commit error:', error.message);
            throw error;
        }
    }

    /**
     * 删除数据集中的文件
     */
    async deleteFile(filePath, commitMessage = `Delete ${filePath}`) {
        try {
            const commitData = {
                operations: [
                    {
                        operation: "delete",
                        path: filePath
                    }
                ],
                commit_message: commitMessage
            };

            const response = await fetch(`${this.baseURL}/commit/main`, {
                method: 'POST',
                headers: this.defaultHeaders,
                body: JSON.stringify(commitData)
            });

            if (!response.ok) {
                // 处理文件不存在的情况，认为删除成功
                if (response.status === 404) {
                    return true;
                }
                const errorText = await response.text();
                throw new Error(`[HuggingFaceStorage] Delete API Error: ${response.status} ${errorText}`);
            }

            return true;
        } catch (error) {
            console.error('[HuggingFaceStorage] Delete error:', error.message);
            return false;
        }
    }

    /**
     * 获取文件流
     */
    async getFile(filePath) {
        try {
            const url = `https://huggingface.co/datasets/${this.repo}/resolve/main/${filePath}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (!response.ok) {
                throw new Error(`[HuggingFaceStorage] Get file error: ${response.status} ${response.statusText}`);
            }

            return response;
        } catch (error) {
            console.error('[HuggingFaceStorage] Get file error:', error.message);
            throw error;
        }
    }

    // --- 以下为 StorageProvider 接口实现 ---

    async put(file, options) {
        const { fileName, originalName } = options;
        if (!fileName) throw new Error('[HuggingFaceStorage] Missing fileName');

        // 为了与原版兼容，读取为 ArrayBuffer
        let fileBuffer;
        if (file instanceof Buffer) {
            fileBuffer = file;
        } else if (typeof file.arrayBuffer === 'function') {
            fileBuffer = await file.arrayBuffer();
        }

        const filesData = { [fileName]: fileBuffer };
        const result = await this.commit(`Upload ${originalName || fileName}`, filesData);
        return {
            id: fileName,
            url: await this.getUrl(fileName)
        };
    }

    async getStream(fileId, options) {
        const res = await this.getFile(fileId);
        return res.body; 
    }

    async getUrl(fileId, options) {
        return `https://huggingface.co/datasets/${this.repo}/resolve/main/${fileId}`;
    }

    async delete(fileId, options) {
        return await this.deleteFile(fileId);
    }

    async exists(fileId) {
        try {
            const url = `https://huggingface.co/datasets/${this.repo}/resolve/main/${fileId}`;
            const response = await fetch(url, {
                method: 'HEAD',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    /**
     * 测试连接：调用数据集 API 验证 Token 和 Repo 有效性
     * @returns {Promise<{ok: boolean, message: string}>}
     */
    async testConnection() {
        try {
            const response = await fetch(this.baseURL, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: AbortSignal.timeout(10000)
            });
            if (response.ok) {
                return { ok: true, message: `数据集 "${this.repo}" 连接成功` };
            }
            if (response.status === 401 || response.status === 403) {
                return { ok: false, message: `认证失败: Token 无效或无权访问该数据集` };
            }
            if (response.status === 404) {
                return { ok: false, message: `数据集 "${this.repo}" 不存在` };
            }
            return { ok: false, message: `连接失败: ${response.status} ${response.statusText}` };
        } catch (err) {
            return { ok: false, message: `连接失败: ${err.name === 'TimeoutError' ? '请求超时' : err.message}` };
        }
    }

    // ========== 分块上传扩展 ==========

    getChunkConfig() {
        return {
            enabled: true,
            chunkThreshold: 40 * 1024 * 1024,  // 40MB 触发分块
            chunkSize: 40 * 1024 * 1024,         // 40MB/块（HF 单文件建议不超过 50MB）
            maxChunks: 100,
            mode: 'generic'
        };
    }

    async putChunk(chunkBuffer, options) {
        const { fileId, chunkIndex, fileName } = options;
        // 分块以 {fileId}/chunk_{index} 形式存入 HF 数据集
        const chunkPath = `chunks/${fileId}/chunk_${String(chunkIndex).padStart(4, '0')}`;
        const filesData = { [chunkPath]: chunkBuffer };
        await this.commit(`Upload chunk ${chunkIndex} of ${fileName || fileId}`, filesData);
        return { storageKey: chunkPath, size: chunkBuffer.length };
    }
}

export default HuggingFaceStorage;
