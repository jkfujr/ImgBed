/**
 * 重构验证模块
 * 合并自 5 个 verify-*.mjs 脚本，复用 lib/ 共享工具
 *
 * 注意：verify-files-admin-create-cleanup 中对 MainLayout 的断言
 * 已被 verify-mainlayout-create-action-split 的后续重构覆盖，
 * 因此 MainLayout 相关断言以后者为准。
 */
import path from 'node:path';
import { readText, expectPresent, expectAbsent, countLines, expectLineCountBelow } from '../../shared/lib/assert.mjs';
import { resolveProjectRoot } from '../../shared/lib/scanner.mjs';

const rootDir = resolveProjectRoot();
const p = (...parts) => path.join(rootDir, ...parts);

/**
 * 验证组定义
 * 每组对应一次重构任务
 */
const checks = [
  {
    name: 'FilesAdmin 创建交互清理',
    source: 'verify-files-admin-create-cleanup.mjs',
    run() {
      const filesAdmin = readText(p('pages', 'admin', 'FilesAdmin.jsx'));
      const toolbar = readText(p('components', 'admin', 'FilesAdminToolbar.jsx'));

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

      expectAbsent(toolbar, /新建/, 'FilesAdminToolbar.jsx 不应新增"新建"按钮');
      expectAbsent(toolbar, /AddIcon/, 'FilesAdminToolbar.jsx 不应引入 AddIcon');
    },
  },

  {
    name: 'AdminDashboard 侧边栏拆分',
    source: 'verify-admin-dashboard-sidebar-split.mjs',
    run() {
      const dashboard = readText(p('pages', 'admin', 'AdminDashboard.jsx'));
      const sidebar = readText(p('components', 'admin', 'AdminSidebar.jsx'));

      expectPresent(dashboard, /<AdminSidebar/, 'AdminDashboard.jsx 应渲染 AdminSidebar');
      expectPresent(dashboard, /<Outlet\s*\/>/, 'AdminDashboard.jsx 应继续保留 Outlet');
      expectAbsent(dashboard, /<Drawer/, 'AdminDashboard.jsx 不应再直接渲染 Drawer');
      expectAbsent(dashboard, /menuItems/, 'AdminDashboard.jsx 不应再直接维护 menuItems');
      expectAbsent(dashboard, /FolderIcon|StorageIcon|SettingsIcon/, 'AdminDashboard.jsx 不应再直接维护侧边栏图标');

      expectPresent(sidebar, /export const ADMIN_MENU_ITEMS/, 'AdminSidebar.jsx 应维护侧边栏菜单配置');
      expectPresent(sidebar, /<Drawer/, 'AdminSidebar.jsx 应承接 Drawer 渲染');
      expectPresent(sidebar, /onToggleCollapse/, 'AdminSidebar.jsx 应暴露折叠切换入口');
      expectPresent(sidebar, /onNavigate/, 'AdminSidebar.jsx 应通过回调处理跳转');
    },
  },

  {
    name: 'MainLayout 新建入口拆分',
    source: 'verify-mainlayout-create-action-split.mjs',
    run() {
      const mainLayout = readText(p('layout', 'MainLayout.jsx'));
      const createActionButton = readText(p('components', 'layout', 'CreateActionButton.jsx'));

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
    },
  },

  {
    name: 'SystemPage 拆分',
    source: 'verify-systempage-split.mjs',
    run() {
      const systemPage = readText(p('pages', 'admin', 'SystemPage.jsx'));
      const systemConfigPanel = readText(p('components', 'admin', 'SystemConfigPanel.jsx'));
      const loadBalancePanel = readText(p('components', 'admin', 'LoadBalancePanel.jsx'));
      const uploadConfigPanel = readText(p('components', 'admin', 'UploadConfigPanel.jsx'));

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
      expectAbsent(systemPage, /label="服务端口"/, 'SystemPage.jsx 不应再直接渲染服务端口输入框');
      expectAbsent(systemPage, /<TextField.*label="CORS/, 'SystemPage.jsx 不应再直接渲染 CORS 输入框');
      expectAbsent(systemPage, /均衡算法/, 'SystemPage.jsx 不应再直接渲染负载均衡表单');
      expectAbsent(systemPage, /容量检查/, 'SystemPage.jsx 不应再直接渲染上传配置表单');

      // SystemPage 行数应降至 50 行以下
      expectLineCountBelow(systemPage, 50, 'SystemPage.jsx');

      // SystemConfigPanel 应承接系统配置逻辑
      expectPresent(systemConfigPanel, /const \[corsOrigin/, 'SystemConfigPanel.jsx 应维护 corsOrigin');
      expectPresent(systemConfigPanel, /const \[maxFileSize/, 'SystemConfigPanel.jsx 应维护 maxFileSize');
      expectPresent(systemConfigPanel, /const \[serverPort/, 'SystemConfigPanel.jsx 应维护 serverPort');
      expectPresent(systemConfigPanel, /const handleSave/, 'SystemConfigPanel.jsx 应维护 handleSave');
      expectPresent(systemConfigPanel, /label="服务端口"/, 'SystemConfigPanel.jsx 应渲染服务端口输入框');

      // LoadBalancePanel 应通过 useLoadBalance Hook 管理状态
      expectPresent(loadBalancePanel, /useLoadBalance/, 'LoadBalancePanel.jsx 应使用 useLoadBalance Hook');
      expectAbsent(loadBalancePanel, /const \[uploadStrategy/, 'LoadBalancePanel.jsx 不应直接维护 uploadStrategy（已提取到 Hook）');
      expectPresent(loadBalancePanel, /均衡算法/, 'LoadBalancePanel.jsx 应渲染负载均衡表单');

      // UploadConfigPanel 应通过 useUploadConfig Hook 管理状态
      expectPresent(uploadConfigPanel, /useUploadConfig/, 'UploadConfigPanel.jsx 应使用 useUploadConfig Hook');
      expectAbsent(uploadConfigPanel, /const \[quotaCheckMode/, 'UploadConfigPanel.jsx 不应直接维护 quotaCheckMode（已提取到 Hook）');
      expectPresent(uploadConfigPanel, /容量检查/, 'UploadConfigPanel.jsx 应渲染上传配置表单');

      const systemPageLines = countLines(systemPage);
      console.log(`  - SystemPage.jsx: ${systemPageLines} 行`);
      console.log(`  - SystemConfigPanel.jsx: ${countLines(systemConfigPanel)} 行`);
      console.log(`  - LoadBalancePanel.jsx: ${countLines(loadBalancePanel)} 行`);
      console.log(`  - UploadConfigPanel.jsx: ${countLines(uploadConfigPanel)} 行`);
    },
  },

  {
    name: 'ApiTokenPanel 拆分',
    source: 'verify-apitokenpanel-split.mjs',
    run() {
      const apiTokenPanel = readText(p('components', 'admin', 'ApiTokenPanel.jsx'));
      const apiTokenList = readText(p('components', 'admin', 'ApiTokenList.jsx'));
      const apiTokenDialog = readText(p('components', 'admin', 'ApiTokenDialog.jsx'));

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
      expectLineCountBelow(apiTokenPanel, 150, 'ApiTokenPanel.jsx');

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

      const panelLines = countLines(apiTokenPanel);
      console.log(`  - ApiTokenPanel.jsx: ${panelLines} 行`);
      console.log(`  - ApiTokenList.jsx: ${countLines(apiTokenList)} 行`);
      console.log(`  - ApiTokenDialog.jsx: ${countLines(apiTokenDialog)} 行`);
    },
  },
];

/**
 * 运行所有重构验证
 * @returns {{ passed: number, failed: number, errors: string[] }}
 */
export function runAllVerifications() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  console.log('\n重构验证检查');
  console.log('='.repeat(60));

  for (const check of checks) {
    try {
      check.run();
      passed++;
      console.log(`  \x1b[32m\u2713\x1b[0m ${check.name}`);
    } catch (err) {
      failed++;
      errors.push(`${check.name}: ${err.message}`);
      console.log(`  \x1b[31m\u2717\x1b[0m ${check.name}`);
      console.log(`    \x1b[31m${err.message}\x1b[0m`);
    }
  }

  console.log('-'.repeat(60));
  console.log(`验证完成: ${passed} 通过, ${failed} 失败 (共 ${checks.length} 组)`);
  console.log('='.repeat(60));

  return { passed, failed, errors };
}

/** 独立运行入口 */
if (process.argv[1] && process.argv[1].includes('refactor-checks')) {
  const result = runAllVerifications();
  if (result.failed > 0) process.exit(1);
}
