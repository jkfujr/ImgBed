import { Readable } from 'stream';

import { toBuffer } from '../../utils/storage-io.js';

function createChunkedReadStream(chunks, getStorage, { start = 0, end, totalSize } = {}) {
  const resolvedTotalSize = Number(totalSize) || chunks.reduce((sum, chunk) => sum + (Number(chunk.size) || 0), 0);
  const resolvedEnd = end === undefined ? resolvedTotalSize - 1 : end;

  async function* iterator() {
    let currentPosition = 0;

    for (const chunk of chunks) {
      const chunkSize = Number(chunk.size) || 0;
      const chunkStart = currentPosition;
      const chunkEnd = currentPosition + chunkSize - 1;
      currentPosition += chunkSize;

      if (chunkEnd < start) {
        continue;
      }

      if (chunkStart > resolvedEnd) {
        return;
      }

      const storage = getStorage(chunk.storage_id);
      if (!storage) {
        throw new Error(`分块渠道 ${chunk.storage_id} 不可用`);
      }

      const localStart = Math.max(0, start - chunkStart);
      const localEnd = Math.min(chunkSize - 1, resolvedEnd - chunkStart);
      const readResult = await storage.getChunkStreamResponse(chunk.storage_key, {
        start: localStart,
        end: localEnd,
      });
      const chunkData = await toBuffer(readResult.stream);
      const expectedLength = localEnd - localStart + 1;
      const shouldSlice = readResult.statusCode !== 206 || chunkData.length !== expectedLength;

      yield shouldSlice
        ? chunkData.subarray(localStart, localEnd + 1)
        : chunkData;

      if (chunkEnd >= resolvedEnd) {
        return;
      }
    }
  }

  return Readable.from(iterator());
}

export {
  createChunkedReadStream,
};
