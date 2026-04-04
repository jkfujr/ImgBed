import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src');
const filesAdminPath = path.join(rootDir, 'pages', 'admin', 'FilesAdmin.jsx');
const filesAdminToolbarPath = path.join(rootDir, 'components', 'admin', 'FilesAdminToolbar.jsx');
const mainLayoutPath = path.join(rootDir, 'layout', 'MainLayout.jsx');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function expectAbsent(content, pattern, message) {
  if (pattern.test(content)) {
    throw new Error(message);
  }
}

function expectPresent(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Error(message);
  }
}

function run() {
  const filesAdmin = readText(filesAdminPath);
  const toolbar = readText(filesAdminToolbarPath);
  const mainLayout = readText(mainLayoutPath);

  expectAbsent(filesAdmin, /FilesAdminCreateMenu/, 'FilesAdmin.jsx 不应再引用 FilesAdminCreateMenu');
  expectAbsent(filesAdmin, /PasteUploadDialog/, 'FilesAdmin.jsx 不应再直接引用 PasteUploadDialog');
  expectAbsent(filesAdmin, /CreateFolderDialog/, 'FilesAdmin.jsx 不应再直接引用 CreateFolderDialog');
  expectAbsent(filesAdmin, /createMenuAnchor/, 'FilesAdmin.jsx 不应再保留 createMenuAnchor 状态');
  expectAbsent(filesAdmin, /pasteDialogOpen/, 'FilesAdmin.jsx 不应再保留 pasteDialogOpen 状态');
  expectAbsent(filesAdmin, /uploadMode/, 'FilesAdmin.jsx 不应再保留 uploadMode 状态');
  expectAbsent(filesAdmin, /folderDialogOpen/, 'FilesAdmin.jsx 不应再保留 folderDialogOpen 状态');
  expectAbsent(filesAdmin, /useNavigate/, 'FilesAdmin.jsx 不应再依赖 useNavigate 处理创建入口');
  expectAbsent(filesAdmin, /useUpload/, 'FilesAdmin.jsx 不应再依赖 useUpload 处理创建入口');
  expectAbsent(filesAdmin, /useCreateDirectory/, 'FilesAdmin.jsx 不应再依赖 useCreateDirectory 处理创建入口');

  expectAbsent(toolbar, /新建/, 'FilesAdminToolbar.jsx 不应新增“新建”按钮');
  expectAbsent(toolbar, /AddIcon/, 'FilesAdminToolbar.jsx 不应引入 AddIcon');

  expectPresent(mainLayout, /handleCreateMenuOpen/, 'MainLayout.jsx 应继续保留统一新建入口');
  expectPresent(mainLayout, /<PasteUploadDialog/, 'MainLayout.jsx 应继续承接上传弹窗');
  expectPresent(mainLayout, /<CreateFolderDialog/, 'MainLayout.jsx 应继续承接创建文件夹弹窗');

  console.log('验证通过：FilesAdmin 已移除失联创建交互，统一入口仍位于 MainLayout。');
}

run();
