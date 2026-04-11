import { Readable } from 'stream';

/**
 * 将流或 Buffer 统一转换为 Buffer。
 * 支持三种输入类型：
 *   - Buffer：直接返回
 *   - Node.js Readable：逐块读取并拼接
 *   - Web ReadableStream：通过 getReader() 逐块读取并拼接
 *
 * @param {Buffer|import('stream').Readable|ReadableStream} stream
 * @returns {Promise<Buffer>}
 */
export async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;

  if (stream instanceof Readable) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Web ReadableStream
  const reader = stream.getReader();
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  return Buffer.concat(parts);
}
