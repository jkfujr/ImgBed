const StorageProvider = require('./base');

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
}

module.exports = HuggingFaceStorage;
