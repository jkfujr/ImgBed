import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.cwd(), 'ImgBed', 'ImgBed-web', 'src');
const systemPagePath = path.join(rootDir, 'pages', 'admin', 'SystemPage.jsx');
const systemConfigPanelPath = path.join(rootDir, 'components', 'admin', 'SystemConfigPanel.jsx');
const loadBalancePanelPath = path.join(rootDir, 'components', 'admin', 'LoadBalancePanel.jsx');
const uploadConfigPanelPath = path.join(rootDir, 'components', 'admin', 'UploadConfigPanel.jsx');

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
  const systemPage = readText(systemPagePath);
  const systemConfigPanel = readText(systemConfigPanelPath);
  const loadBalancePanel = readText(loadBalancePanelPath);
  const uploadConfigPanel = readText(uploadConfigPanelPath);

  // SystemPage 应只保留 Tab 导航
  expectPresent(systemPage, /<Tabs/, 'SystemPage.jsx 应保留 Tabs 导航');
  expectPresent(systemPage, /currentTab/, 'SystemPage.jsx 应保留 currentTab 状态');
  expectPresent(systemPage, /<SystemConfigPanel/, 'SystemPage.jsx 应渲染 SystemConfigPanel');
  expectPresent(systemPage, /<LoadBalancePanel/, 'SystemPage.jsx 应渲染 LoadBalancePanel');
  expectPresent(systemPage, /<UploadConfigPanel/, 'SystemPage.jsx 应渲染 UploadConfigPanel');

  // SystemPage 不应再维护 27 个状态
  expectAbsent(systemPage, /const \[corsOrigin/, 'SystemPage.jsx 不应再维护 corsOrigin');
  expectAbsent(systemPage, /const \[maxFileSize/, 'SystemPage.jsx 不应再维护 maxFileSize');
  expectAbsent(systemPage, /const \[serverPort/, 'SystemPage.jsx 不应再维护 serverPort');
  expectAbsent(systemPage, /const \[lbSaving/, 'SystemPage.jsx 不应再维护 lbSaving');
  expectAbsent(systemPage, /const \[uploadStrategy/, 'SystemPage.jsx 不应再维护 uploadStrategy');
  expectAbsent(systemPage, /const \[quotaCheckMode/, 'SystemPage.jsx 不应再维护 quotaCheckMode');
  expectAbsent(systemPage, /const \[sysEnableSizeLimit/, 'SystemPage.jsx 不应再维护 sysEnableSizeLimit');

  // SystemPage 不应再维护处理函数
  expectAbsent(systemPage, /const handleSave/, 'SystemPage.jsx 不应再维护 handleSave');
  expectAbsent(systemPage, /const handleSaveLb/, 'SystemPage.jsx 不应再维护 handleSaveLb');
  expectAbsent(systemPage, /const handleSaveUploadConfig/, 'SystemPage.jsx 不应再维护 handleSaveUploadConfig');

  // SystemPage 不应再直接渲染配置表单
  expectAbsent(systemPage, /<TextField.*label="服务端口"/, 'SystemPage.jsx 不应再直接渲染服务端口输入框');
  expectAbsent(systemPage, /<TextField.*label="CORS/, 'SystemPage.jsx 不应再直接渲染 CORS 输入框');
  expectAbsent(systemPage, /均衡算法/, 'SystemPage.jsx 不应再直接渲染负载均衡表单');
  expectAbsent(systemPage, /容量检查/, 'SystemPage.jsx 不应再直接渲染上传配置表单');

  // SystemPage 行数应降至 50 行以下
  const systemPageLines = countLines(systemPage);
  if (systemPageLines > 50) {
    throw new Error(`SystemPage.jsx 行数应降至 50 行以下，当前 ${systemPageLines} 行`);
  }

  // SystemConfigPanel 应承接系统配置逻辑
  expectPresent(systemConfigPanel, /const \[corsOrigin/, 'SystemConfigPanel.jsx 应维护 corsOrigin');
  expectPresent(systemConfigPanel, /const \[maxFileSize/, 'SystemConfigPanel.jsx 应维护 maxFileSize');
  expectPresent(systemConfigPanel, /const \[serverPort/, 'SystemConfigPanel.jsx 应维护 serverPort');
  expectPresent(systemConfigPanel, /const handleSave/, 'SystemConfigPanel.jsx 应维护 handleSave');
  expectPresent(systemConfigPanel, /label="服务端口"/, 'SystemConfigPanel.jsx 应渲染服务端口输入框');

  // LoadBalancePanel 应承接负载均衡逻辑
  expectPresent(loadBalancePanel, /const \[uploadStrategy/, 'LoadBalancePanel.jsx 应维护 uploadStrategy');
  expectPresent(loadBalancePanel, /const \[lbStrategy/, 'LoadBalancePanel.jsx 应维护 lbStrategy');
  expectPresent(loadBalancePanel, /const \[availableChannels/, 'LoadBalancePanel.jsx 应维护 availableChannels');
  expectPresent(loadBalancePanel, /const handleSave/, 'LoadBalancePanel.jsx 应维护 handleSave');
  expectPresent(loadBalancePanel, /均衡算法/, 'LoadBalancePanel.jsx 应渲染负载均衡表单');

  // UploadConfigPanel 应承接上传配置逻辑
  expectPresent(uploadConfigPanel, /const \[quotaCheckMode/, 'UploadConfigPanel.jsx 应维护 quotaCheckMode');
  expectPresent(uploadConfigPanel, /const \[sysEnableSizeLimit/, 'UploadConfigPanel.jsx 应维护 sysEnableSizeLimit');
  expectPresent(uploadConfigPanel, /const \[defaultSizeLimitMB/, 'UploadConfigPanel.jsx 应维护 defaultSizeLimitMB');
  expectPresent(uploadConfigPanel, /const handleSave/, 'UploadConfigPanel.jsx 应维护 handleSave');
  expectPresent(uploadConfigPanel, /容量检查/, 'UploadConfigPanel.jsx 应渲染上传配置表单');

  console.log('验证通过：SystemPage 已完成拆分。');
  console.log(`  - SystemPage.jsx: ${systemPageLines} 行`);
  console.log(`  - SystemConfigPanel.jsx: ${countLines(systemConfigPanel)} 行`);
  console.log(`  - LoadBalancePanel.jsx: ${countLines(loadBalancePanel)} 行`);
  console.log(`  - UploadConfigPanel.jsx: ${countLines(uploadConfigPanel)} 行`);
}

run();
