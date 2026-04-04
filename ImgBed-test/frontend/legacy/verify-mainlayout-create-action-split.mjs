import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src');
const mainLayoutPath = path.join(rootDir, 'layout', 'MainLayout.jsx');
const createActionButtonPath = path.join(rootDir, 'components', 'layout', 'CreateActionButton.jsx');

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
  const mainLayout = readText(mainLayoutPath);
  const createActionButton = readText(createActionButtonPath);

  // MainLayout 应保留顶部"新建"按钮入口
  expectPresent(mainLayout, /<CreateActionButton/, 'MainLayout.jsx 应渲染 CreateActionButton');
  expectPresent(mainLayout, /showCreateButton/, 'MainLayout.jsx 应保留 showCreateButton 判断');

  // MainLayout 不应再直接维护新建入口相关状态
  expectAbsent(mainLayout, /createMenuAnchor/, 'MainLayout.jsx 不应再维护 createMenuAnchor');
  expectAbsent(mainLayout, /pasteDialogOpen/, 'MainLayout.jsx 不应再维护 pasteDialogOpen');
  expectAbsent(mainLayout, /uploadMode/, 'MainLayout.jsx 不应再维护 uploadMode');
  expectAbsent(mainLayout, /folderDialogOpen/, 'MainLayout.jsx 不应再维护 folderDialogOpen');
  expectAbsent(mainLayout, /channelDialogOpen/, 'MainLayout.jsx 不应再维护 channelDialogOpen');

  // MainLayout 不应再直接维护新建入口相关处理函数
  expectAbsent(mainLayout, /handleCreateMenuOpen/, 'MainLayout.jsx 不应再维护 handleCreateMenuOpen');
  expectAbsent(mainLayout, /handleUploadImage/, 'MainLayout.jsx 不应再维护 handleUploadImage');
  expectAbsent(mainLayout, /handlePasteUploadFile/, 'MainLayout.jsx 不应再维护 handlePasteUploadFile');
  expectAbsent(mainLayout, /handleCreateFolderConfirm/, 'MainLayout.jsx 不应再维护 handleCreateFolderConfirm');
  expectAbsent(mainLayout, /handleAddChannel/, 'MainLayout.jsx 不应再维护 handleAddChannel');

  // MainLayout 不应再直接渲染新建菜单与弹窗
  expectAbsent(mainLayout, /<PasteUploadDialog/, 'MainLayout.jsx 不应再直接渲染 PasteUploadDialog');
  expectAbsent(mainLayout, /<CreateFolderDialog/, 'MainLayout.jsx 不应再直接渲染 CreateFolderDialog');
  expectAbsent(mainLayout, /<ChannelDialog/, 'MainLayout.jsx 不应再直接渲染 ChannelDialog');
  expectAbsent(mainLayout, /上传图片|上传目录|剪贴板上传|创建文件夹|新增渠道/, 'MainLayout.jsx 不应再直接渲染新建菜单项');

  // MainLayout 不应再直接引入新建入口相关依赖
  expectAbsent(mainLayout, /useUpload/, 'MainLayout.jsx 不应再引入 useUpload');
  expectAbsent(mainLayout, /useCreateDirectory/, 'MainLayout.jsx 不应再引入 useCreateDirectory');
  expectAbsent(mainLayout, /useRefresh/, 'MainLayout.jsx 不应再引入 useRefresh');

  // MainLayout 应继续保留搜索入口
  expectPresent(mainLayout, /searchDialogOpen/, 'MainLayout.jsx 应继续保留 searchDialogOpen');
  expectPresent(mainLayout, /<SearchDialog/, 'MainLayout.jsx 应继续渲染 SearchDialog');

  // CreateActionButton 应承接新建入口逻辑
  expectPresent(createActionButton, /createMenuAnchor/, 'CreateActionButton.jsx 应维护 createMenuAnchor');
  expectPresent(createActionButton, /pasteDialogOpen/, 'CreateActionButton.jsx 应维护 pasteDialogOpen');
  expectPresent(createActionButton, /uploadMode/, 'CreateActionButton.jsx 应维护 uploadMode');
  expectPresent(createActionButton, /folderDialogOpen/, 'CreateActionButton.jsx 应维护 folderDialogOpen');
  expectPresent(createActionButton, /channelDialogOpen/, 'CreateActionButton.jsx 应维护 channelDialogOpen');

  // CreateActionButton 应承接新建菜单与弹窗渲染
  expectPresent(createActionButton, /<PasteUploadDialog/, 'CreateActionButton.jsx 应渲染 PasteUploadDialog');
  expectPresent(createActionButton, /<CreateFolderDialog/, 'CreateActionButton.jsx 应渲染 CreateFolderDialog');
  expectPresent(createActionButton, /<ChannelDialog/, 'CreateActionButton.jsx 应渲染 ChannelDialog');
  expectPresent(createActionButton, /上传图片/, 'CreateActionButton.jsx 应渲染新建菜单项');

  // CreateActionButton 应复用现有业务 hook
  expectPresent(createActionButton, /useUpload/, 'CreateActionButton.jsx 应使用 useUpload');
  expectPresent(createActionButton, /useCreateDirectory/, 'CreateActionButton.jsx 应使用 useCreateDirectory');
  expectPresent(createActionButton, /useRefresh/, 'CreateActionButton.jsx 应使用 useRefresh');

  console.log('验证通过：MainLayout 统一新建入口已完成拆分。');
}

run();
