/**
 * 存储抽象基类
 * 所有具体的存储渠道（如 Local, S3, Telegram 等）都需继承并实现此接口
 */
class StorageProvider {
  /**
   * 上传文件
   * @param {File|Buffer} file 文件对象或二进制流
   * @param {Object} options 其他元数据选项（如 fileName, originalName）
   * @returns {Promise<Object>} 返回存储后的关键信息 (如 id, url)
   */
  async put(file, options) { throw new Error('Not implemented: put()'); }

  /**
   * 获取文件信息
   * @param {string} id 存储ID
   * @returns {Promise<Object>}
   */
  async get(id) { throw new Error('Not implemented: get()'); }

  /**
   * 删除文件
   * @param {string} id 存储ID
   * @param {Object} options 其他选项（例如关联的 token 等）
   * @returns {Promise<boolean>}
   */
  async delete(id, options) { throw new Error('Not implemented: delete()'); }

  /**
   * 获取文件可读流 (主要供直接访问返回 Response 使用)
   * @param {string} id 存储ID
   * @param {Object} options 其他选项 (支持范围请求)
   * @returns {Promise<ReadableStream|Buffer>}
   */
  async getStream(id, options) { throw new Error('Not implemented: getStream()'); }

  /**
   * 获取文件直接访问 URL (如果可行的话)
   * @param {string} id 存储ID
   * @param {Object} options 其他选项
   * @returns {Promise<string>}
   */
  async getUrl(id, options) { throw new Error('Not implemented: getUrl()'); }

  /**
   * 检查文件是否存在
   * @param {string} id 存储ID
   * @returns {Promise<boolean>}
   */
  async exists(id) { throw new Error('Not implemented: exists()'); }

  /**
   * 测试连接是否可用
   * 子类应覆盖此方法以提供特定的连接测试逻辑
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('该存储类型不支持连接测试');
  }

  // ========== 分块上传扩展接口 ==========

  /**
   * 获取分块配置（同步，纯声明）
   * 子类覆盖此方法以声明自身分块能力
   * @returns {{ enabled: boolean, chunkThreshold: number, chunkSize: number, maxChunks: number, mode: 'generic'|'native' }}
   */
  getChunkConfig() {
    return { enabled: false, chunkThreshold: Infinity, chunkSize: 0, maxChunks: 0, mode: 'generic' };
  }

  /**
   * 上传单个分块（通用分块模式，需子类实现）
   * @param {Buffer} chunkBuffer - 分块二进制数据
   * @param {Object} options - { fileId, chunkIndex, totalChunks, fileName, mimeType }
   * @returns {Promise<{ storageKey: string, size: number }>}
   */
  async putChunk(chunkBuffer, options) {
    throw new Error('Not implemented: putChunk()');
  }

  /**
   * 获取单个分块的可读流（默认回退到 getStream）
   * @param {string} storageKey - 分块存储键
   * @param {Object} options - 可选参数
   * @returns {Promise<ReadableStream|Buffer>}
   */
  async getChunkStream(storageKey, options) {
    return this.getStream(storageKey, options);
  }

  /**
   * 删除单个分块（默认回退到 delete）
   * @param {string} storageKey - 分块存储键
   * @returns {Promise<boolean>}
   */
  async deleteChunk(storageKey) {
    return this.delete(storageKey);
  }
}

module.exports = StorageProvider;
