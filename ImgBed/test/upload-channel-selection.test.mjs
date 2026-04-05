import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const apiModuleUrl = pathToFileURL(path.resolve(workspaceRoot, '../ImgBed-web/src/api.js')).href;
const dialogPath = path.resolve(workspaceRoot, '../ImgBed-web/src/components/common/PasteUploadDialog.jsx');

async function testUploadDocsAppendsChannel() {
  const originalFormData = globalThis.FormData;
  class FakeFormData {
    constructor() {
      this.entries = [];
    }

    append(key, value) {
      this.entries.push([key, value]);
    }
  }

  globalThis.FormData = FakeFormData;

  try {
    const { UploadDocs, api } = await import(`${apiModuleUrl}?case=with-channel-${Date.now()}`);
    let capturedPayload = null;
    const originalPost = api.post;
    api.post = async (_url, formData) => {
      capturedPayload = formData.entries;
      return { code: 0, data: {} };
    };

    try {
      await UploadDocs.upload({ name: 'demo.png' }, { channel: 's3-1', directory: 'foo' });
    } finally {
      api.post = originalPost;
    }

    assert.deepEqual(capturedPayload, [
      ['file', { name: 'demo.png' }],
      ['directory', 'foo'],
      ['channel', 's3-1'],
    ]);
  } finally {
    globalThis.FormData = originalFormData;
  }
}

async function testUploadDocsOmitsChannelWhenUsingDefault() {
  const originalFormData = globalThis.FormData;
  class FakeFormData {
    constructor() {
      this.entries = [];
    }

    append(key, value) {
      this.entries.push([key, value]);
    }
  }

  globalThis.FormData = FakeFormData;

  try {
    const { UploadDocs, api } = await import(`${apiModuleUrl}?case=without-channel-${Date.now()}`);
    let capturedPayload = null;
    const originalPost = api.post;
    api.post = async (_url, formData) => {
      capturedPayload = formData.entries;
      return { code: 0, data: {} };
    };

    try {
      await UploadDocs.upload({ name: 'demo.png' }, { directory: 'foo' });
    } finally {
      api.post = originalPost;
    }

    assert.deepEqual(capturedPayload, [
      ['file', { name: 'demo.png' }],
      ['directory', 'foo'],
    ]);
  } finally {
    globalThis.FormData = originalFormData;
  }
}

async function testPasteUploadDialogUsesSameChannelForBatch() {
  const source = await fs.readFile(dialogPath, 'utf8');

  assert.match(source, /const uploadOptions = selectedChannel === DEFAULT_CHANNEL \? \{\} : \{ channel: selectedChannel \};/);
  assert.match(source, /await onUpload\(files\[i\], uploadOptions\);/);
}

async function main() {
  await testUploadDocsAppendsChannel();
  await testUploadDocsOmitsChannelWhenUsingDefault();
  await testPasteUploadDialogUsesSameChannelForBatch();
  console.log('upload channel selection tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
