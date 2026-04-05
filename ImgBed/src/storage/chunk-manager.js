/**
 * 通用分块管理器
 * 纯静态方法的工具类，无自身状态（所有持久状态在 DB 中）
 * 负责分块判断、切分上传、合并读取、Range 计算
 */

import pLimit from 'p-limit';
import { Readable } from 'stream';
import { sqlite } from '../database/index.js';

class ChunkManager {

    /**
     * 判断是否需要分块上传
     * @param {StorageProvider} storage - 存储渠道实例
     * @param {number} fileSize - 文件大小（字节）
     * @param {Object} options - 可选参数
     * @param {Object} options.channelConfig - 渠道级分块配置覆盖
     * @returns {{ needsChunking: boolean, config?: Object, totalChunks?: number }}
     */
    static analyze(storage, fileSize, options = {}) {
        let config = storage.getChunkConfig();
        const { channelConfig } = options;

        // 渠道级配置覆盖（前端管理员设置的分片参数优先于代码默认值）
        if (channelConfig && channelConfig.enableChunking) {
            config = {
                ...config,
                enabled: true,
                chunkThreshold: (channelConfig.sizeLimitMB || 10) * 1024 * 1024,
                chunkSize: (channelConfig.chunkSizeMB || 5) * 1024 * 1024,
                maxChunks: channelConfig.maxChunks > 0 ? channelConfig.maxChunks : (config.maxChunks || 1000),
            };
        }

        if (!config.enabled || fileSize <= config.chunkThreshold) {
            return { needsChunking: false };
        }
        const totalChunks = Math.ceil(fileSize / config.chunkSize);
        if (totalChunks > config.maxChunks) {
            const maxSize = ((config.chunkSize * config.maxChunks) / (1024 * 1024)).toFixed(0);
            throw new Error(`文件过大，当前渠道最大支持 ${maxSize}MB`);
        }
        return { needsChunking: true, config, totalChunks };
    }

    /**
     * 通用分块上传
     * 将文件 Buffer 切分为多个块，逐块调用 putChunk，记录到 chunks 表
     * @param {StorageProvider} storage - 存储渠道实例
     * @param {Buffer} buffer - 完整文件 Buffer
     * @param {Object} options - { fileId, fileName, originalName, mimeType, storageId }
     * @returns {Promise<{ chunkCount: number, totalSize: number }>}
     */
    static async uploadChunked(storage, buffer, options) {
        const config = storage.getChunkConfig();
        const totalChunks = Math.ceil(buffer.length / config.chunkSize);
        const chunkRecords = [];
        const limit = pLimit(3);

        try {
            const tasks = Array.from({ length: totalChunks }, (_, i) =>
                limit(async () => {
                    const start = i * config.chunkSize;
                    const end = Math.min(start + config.chunkSize, buffer.length);
                    const chunkBuffer = buffer.subarray(start, end);

                    let result;
                    for (let attempt = 0; attempt <= 2; attempt++) {
                        try {
                            result = await storage.putChunk(chunkBuffer, {
                                fileId: options.fileId,
                                chunkIndex: i,
                                totalChunks,
                                fileName: options.fileName,
                                mimeType: options.mimeType
                            });
                            break;
                        } catch (err) {
                            console.warn(`[ChunkManager] 分块 ${i} 第 ${attempt + 1} 次尝试失败: ${err.message}`);
                            if (attempt >= 2) throw err;
                            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                        }
                    }

                    const record = {
                        file_id: options.fileId,
                        chunk_index: i,
                        storage_type: storage.constructor.name.replace('Storage', '').toLowerCase(),
                        storage_id: options.storageId,
                        storage_key: result.storageKey,
                        storage_config: JSON.stringify({}),
                        size: result.size
                    };
                    chunkRecords.push(record);
                    return record;
                })
            );

            const records = await Promise.all(tasks);
            chunkRecords.length = 0;
            chunkRecords.push(...records.sort((a, b) => a.chunk_index - b.chunk_index));
        } catch (err) {
            console.warn(`[ChunkManager] 分块上传中途失败，清理 ${chunkRecords.length} 个已上传块`);
            for (const record of chunkRecords) {
                try {
                    await storage.deleteChunk(record.storage_key);
                } catch (cleanErr) {
                    console.warn(`[ChunkManager] 清理孤儿块 ${record.storage_key} 失败（忽略）:`, cleanErr.message);
                }
            }
            throw err;
        }

        const insertChunkStmt = sqlite.prepare(`INSERT INTO chunks (
            file_id, chunk_index, storage_type, storage_id, storage_key, storage_config, size
        ) VALUES (
            @file_id, @chunk_index, @storage_type, @storage_id, @storage_key, @storage_config, @size
        )`);

        const insertChunkBatch = sqlite.transaction((records) => {
            for (const record of records) insertChunkStmt.run(record);
        });

        insertChunkBatch(chunkRecords);

        return { chunkCount: totalChunks, totalSize: buffer.length };
    }

    /**
     * S3 原生 multipart 上传
     * 利用 S3 的 CreateMultipartUpload / UploadPart / CompleteMultipartUpload 协议
     * 完成后在 S3 侧是完整对象，不需要标记 is_chunked
     * @param {S3Storage} storage - S3 存储渠道实例
     * @param {Buffer} buffer - 完整文件 Buffer
     * @param {Object} options - { fileId, fileName, originalName, mimeType, storageId }
     * @returns {Promise<{ id: string, totalSize: number }>}
     */
    static async uploadS3Multipart(storage, buffer, options) {
        const config = storage.getChunkConfig();
        const totalChunks = Math.ceil(buffer.length / config.chunkSize);
        let multipart;

        try {
            multipart = await storage.initMultipartUpload({
                fileName: options.fileName,
                mimeType: options.mimeType
            });

            const parts = [];
            for (let i = 0; i < totalChunks; i++) {
                const start = i * config.chunkSize;
                const end = Math.min(start + config.chunkSize, buffer.length);
                const chunkBuffer = buffer.subarray(start, end);

                const part = await storage.uploadPart(chunkBuffer, {
                    uploadId: multipart.uploadId,
                    key: multipart.key,
                    partNumber: i + 1  // S3 PartNumber 从 1 开始
                });
                parts.push(part);
            }

            const result = await storage.completeMultipartUpload({
                uploadId: multipart.uploadId,
                key: multipart.key,
                parts
            });

            return { id: result.id, totalSize: buffer.length };
        } catch (err) {
            // 失败时中止 multipart upload，释放 S3 资源
            if (multipart?.uploadId) {
                try {
                    await storage.abortMultipartUpload({
                        uploadId: multipart.uploadId,
                        key: multipart.key
                    });
                } catch (abortErr) {
                    console.error('[ChunkManager] S3 abort multipart 失败:', abortErr.message);
                }
            }
            throw err;
        }
    }

    /**
     * 构建跨片合并流，支持 Range 请求
     * @param {Array} chunks - 从 DB 查出的 chunks 记录，按 chunk_index 排序
     * @param {Function} getStorageFn - (storageId) => StorageProvider
     * @param {Object} rangeOptions - { start, end, totalSize }
     * @returns {ReadableStream}
     */
    static createChunkedReadStream(chunks, getStorageFn, { start = 0, end, totalSize }) {
        if (end === undefined) end = totalSize - 1;
        let currentPosition = 0;
        let chunkIdx = 0;

        return new ReadableStream({
            async pull(controller) {
                while (chunkIdx < chunks.length) {
                    const chunk = chunks[chunkIdx];
                    const chunkSize = chunk.size;
                    const chunkStart = currentPosition;
                    const chunkEnd = currentPosition + chunkSize - 1;

                    chunkIdx++;
                    currentPosition += chunkSize;

                    // 整块在 range 之前，跳过
                    if (chunkEnd < start) continue;

                    // 整块在 range 之后，结束
                    if (chunkStart > end) {
                        controller.close();
                        return;
                    }

                    // 拉取该分块数据
                    const storage = getStorageFn(chunk.storage_id);
                    if (!storage) {
                        controller.error(new Error(`分块渠道 ${chunk.storage_id} 不可用`));
                        return;
                    }

                    const stream = await storage.getChunkStream(chunk.storage_key, {});
                    // 将流转为 Buffer（单块大小有限，不会 OOM）
                    const chunkData = await ChunkManager._streamToBuffer(stream);

                    // 计算本块内需要截取的范围
                    const sliceStart = Math.max(0, start - chunkStart);
                    const sliceEnd = Math.min(chunkSize, end - chunkStart + 1);
                    controller.enqueue(new Uint8Array(chunkData.subarray(sliceStart, sliceEnd)));

                    // 如果是最后一个需要的块，关闭流
                    if (chunkEnd >= end) {
                        controller.close();
                        return;
                    }
                }
                controller.close();
            }
        });
    }

    /**
     * 查询文件的所有分块记录
     * @param {string} fileId - 文件 ID
     * @returns {Promise<Array>} 按 chunk_index 排序的分块记录
     */
    static async getChunks(fileId) {
        return sqlite.prepare(
            'SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index ASC'
        ).all(fileId);
    }

    /**
     * 删除文件的所有分块（物理存储 + 数据库记录）
     * @param {string} fileId - 文件 ID
     * @param {Function} getStorageFn - (storageId) => StorageProvider
     */
    static async deleteChunks(fileId, getStorageFn) {
        const chunks = await this.getChunks(fileId);

        for (const chunk of chunks) {
            try {
                const storage = getStorageFn(chunk.storage_id);
                if (storage) {
                    await storage.deleteChunk(chunk.storage_key);
                }
            } catch (err) {
                console.warn(`[ChunkManager] 删除分块 ${chunk.storage_key} 失败（忽略）:`, err.message);
            }
        }

        sqlite.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
    }

    /**
     * 将 ReadableStream / Buffer / Node.Readable 转为 Buffer
     * @param {ReadableStream|Buffer|Readable} stream
     * @returns {Promise<Buffer>}
     */
    static async _streamToBuffer(stream) {
        if (Buffer.isBuffer(stream)) return stream;

        // Node.js Readable
        if (stream instanceof Readable) {
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        }

        // Web ReadableStream
        const reader = stream.getReader();
        const parts = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
        }
        return Buffer.concat(parts);
    }
}

export default ChunkManager;
