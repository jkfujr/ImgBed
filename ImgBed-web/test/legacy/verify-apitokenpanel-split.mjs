import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.cwd(), 'ImgBed', 'ImgBed-web', 'src');
const apiTokenPanelPath = path.join(rootDir, 'components', 'admin', 'ApiTokenPanel.jsx');
const apiTokenListPath = path.join(rootDir, 'components', 'admin', 'ApiTokenList.jsx');
const apiTokenDialogPath = path.join(rootDir, 'components', 'admin', 'ApiTokenDialog.jsx');

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

function countLines(content) {
  return content.split('\n').length;
}

function run() {
  const apiTokenPanel = readText(apiTokenPanelPath);
  const apiTokenList = readText(apiTokenListPath);
  const apiTokenDialog = readText(apiTokenDialogPath);

  // ApiTokenPanel 应只保留容器逻辑
  expectPresent(apiTokenPanel, /<ApiTokenList/, 'ApiTokenPanel.jsx 应渲染 ApiTokenList');
  expectPresent(apiTokenPanel, /<ApiTokenDialog/, 'ApiTokenPanel.jsx 应渲染 ApiTokenDialog');
  expectPresent(apiTokenPanel, /const loadTokens/, 'ApiTokenPanel.jsx 应维护 loadTokens');
  expectPresent(apiTokenPanel, /const handleCreate/, 'ApiTokenPanel.jsx 应维护 handleCreate');
  expectPresent(apiTokenPanel, /const handleDelete/, 'ApiTokenPanel.jsx 应维护 handleDelete');

  // ApiTokenPanel 不应再维护表单状态
  expectAbsent(apiTokenPanel, /const \[form, setForm\]/, 'ApiTokenPanel.jsx 不应再维护 form 状态');
  expectAbsent(apiTokenPanel, /const \[createResult/, 'ApiTokenPanel.jsx 不应再维护 createResult');
  expectAbsent(apiTokenPanel, /const togglePermission/, 'ApiTokenPanel.jsx 不应再维护 togglePermission');
  expectAbsent(apiTokenPanel, /const copyToken/, 'ApiTokenPanel.jsx 不应再维护 copyToken');

  // ApiTokenPanel 不应再直接渲染表格与表单
  expectAbsent(apiTokenPanel, /<Table/, 'ApiTokenPanel.jsx 不应再直接渲染 Table');
  expectAbsent(apiTokenPanel, /<TableHead/, 'ApiTokenPanel.jsx 不应再直接渲染 TableHead');
  expectAbsent(apiTokenPanel, /Token 名称/, 'ApiTokenPanel.jsx 不应再直接渲染表单字段');
  expectAbsent(apiTokenPanel, /权限.*FormControl/, 'ApiTokenPanel.jsx 不应再直接渲染权限表单');

  // ApiTokenPanel 行数应降至 150 行以下
  const panelLines = countLines(apiTokenPanel);
  if (panelLines > 150) {
    throw new Error(`ApiTokenPanel.jsx 行数应降至 150 行以下，当前 ${panelLines} 行`);
  }

  // ApiTokenList 应承接列表渲染逻辑
  expectPresent(apiTokenList, /<Table/, 'ApiTokenList.jsx 应渲染 Table');
  expectPresent(apiTokenList, /<TableHead/, 'ApiTokenList.jsx 应渲染 TableHead');
  expectPresent(apiTokenList, /tokens\.map/, 'ApiTokenList.jsx 应遍历渲染 tokens');
  expectPresent(apiTokenList, /onDelete/, 'ApiTokenList.jsx 应接收 onDelete 回调');

  // ApiTokenDialog 应承接对话框逻辑
  expectPresent(apiTokenDialog, /const \[form, setForm\]/, 'ApiTokenDialog.jsx 应维护 form 状态');
  expectPresent(apiTokenDialog, /const \[createResult/, 'ApiTokenDialog.jsx 应维护 createResult');
  expectPresent(apiTokenDialog, /const togglePermission/, 'ApiTokenDialog.jsx 应维护 togglePermission');
  expectPresent(apiTokenDialog, /const copyToken/, 'ApiTokenDialog.jsx 应维护 copyToken');
  expectPresent(apiTokenDialog, /Token 名称/, 'ApiTokenDialog.jsx 应渲染表单字段');
  expectPresent(apiTokenDialog, /onSubmit/, 'ApiTokenDialog.jsx 应接收 onSubmit 回调');

  console.log('验证通过：ApiTokenPanel 已完成拆分。');
  console.log(`  - ApiTokenPanel.jsx: ${panelLines} 行`);
  console.log(`  - ApiTokenList.jsx: ${countLines(apiTokenList)} 行`);
  console.log(`  - ApiTokenDialog.jsx: ${countLines(apiTokenDialog)} 行`);
}

run();
