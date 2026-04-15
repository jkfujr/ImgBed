import StorageProvider from './base.js';
import { createLogger } from '../utils/logger.js';
import { createStorageChunkPutResult, createStoragePutResult, createStorageReadResultFromResponse } from './contract.js';
import { toBuffer } from '../utils/storage-io.js';

const log = createLogger('huggingface');

/**
 * HuggingFace API 封装类
 * 实现 StorageProvider 统一接口
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
                throw new Error('文件内容类型无效');
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
                throw new Error(`[HuggingFaceStorage] 接口请求失败: ${response.status} ${response.statusText} - ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            log.error({ err: error }, '提交请求失败');
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
                throw new Error(`[HuggingFaceStorage] 删除请求失败: ${response.status} ${errorText}`);
            }

            return true;
        } catch (error) {
            log.error({ err: error }, '删除请求失败');
            return false;
        }
    }

    /**
     * 获取文件流
     */
    async getFile(filePath, options = {}) {
        try {
            const url = `https://huggingface.co/datasets/${this.repo}/resolve/main/${filePath}`;
            const headers = {
                'Authorization': `Bearer ${this.token}`
            };
            if (options.start !== undefined && options.end !== undefined) {
                headers.Range = `bytes=${options.start}-${options.end}`;
            }
            const response = await fetch(url, {
                headers
            });

            if (!response.ok) {
                throw new Error(`[HuggingFaceStorage] 获取文件失败: ${response.status} ${response.statusText}`);
            }

            return response;
        } catch (error) {
            log.error({ err: error }, '获取文件失败');
            throw error;
        }
    }

    // --- 以下为 StorageProvider 接口实现 ---

    async put(file, options) {
        const { fileName, originalName } = options;
        if (!fileName) throw new Error('[HuggingFaceStorage] 缺少 fileName');
        const fileBuffer = await toBuffer(file);

        const filesData = { [fileName]: fileBuffer };
        await this.commit(`Upload ${originalName || fileName}`, filesData);
        return createStoragePutResult({
            storageKey: fileName,
            size: fileBuffer.length,
        });
    }

    async getStreamResponse(fileId, options = {}) {
        const res = await this.getFile(fileId, options);
        return createStorageReadResultFromResponse(res);
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
        await this.commit(`上传分块 ${chunkIndex}，文件 ${fileName || fileId}`, filesData);
        return createStorageChunkPutResult({
            storageKey: chunkPath,
            size: chunkBuffer.length,
        });
    }

    /**
     * 批量分块上传：将所有块合并为单次 commit，减少 API 请求次数
     * 由通用分块写入器自动检测并调用
     * @returns {Promise<{ chunkCount: number, totalSize: number, chunkRecords: Array }>}
     */
    async uploadChunkedBatch(buffer, options) {
        const config = this.getChunkConfig();
        const totalChunks = Math.ceil(buffer.length / config.chunkSize);
        const { fileId, fileName, storageId, storageType } = options;

        const filesData = {};
        const chunkRecords = [];

        for (let i = 0; i < totalChunks; i++) {
            const start = i * config.chunkSize;
            const end = Math.min(start + config.chunkSize, buffer.length);
            const chunkPath = `chunks/${fileId}/chunk_${String(i).padStart(4, '0')}`;
            filesData[chunkPath] = buffer.subarray(start, end);
            chunkRecords.push({
                file_id: fileId,
                chunk_index: i,
                storage_type: storageType || 'huggingface',
                storage_id: storageId,
                storage_key: chunkPath,
                storage_meta: null,
                size: end - start,
            });
        }

        await this.commit(`Upload ${totalChunks} chunks of ${fileName || fileId}`, filesData);
        log.info({ fileId, totalChunks }, 'HuggingFace 批量分块上传完成');

        return { chunkCount: totalChunks, totalSize: buffer.length, chunkRecords };
    }
}

export default HuggingFaceStorage;
