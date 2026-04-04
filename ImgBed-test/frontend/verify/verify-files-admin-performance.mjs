import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(process.cwd(), 'ImgBed-web');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testFilesAdminContentUsesIncrementalRendering() {
  const content = read('src/components/admin/FilesAdminContent.jsx');

  assert(content.includes('const INITIAL_RENDER_COUNT = {'), 'FilesAdminContent 缺少首批渲染量配置');
  assert(content.includes("masonry: 24"), 'FilesAdminContent 缺少 masonry 首批渲染量');
  assert(content.includes("list: 40"), 'FilesAdminContent 缺少 list 首批渲染量');
  assert(content.includes('const [visibleCount, setVisibleCount] = useState(initialRenderCount);'), 'FilesAdminContent 未维护可见数量状态');
  assert(content.includes('const visibleData = useMemo('), 'FilesAdminContent 未对可见文件做切片');
  assert(content.includes('data.slice(0, visibleCount)'), 'FilesAdminContent 未按可见数量裁剪文件');
  assert(content.includes("viewMode === 'masonry' && ("), 'FilesAdminContent 未按视图模式条件挂载瀑布流');
  assert(content.includes("viewMode === 'list' && ("), 'FilesAdminContent 未按视图模式条件挂载列表');
  assert(!content.includes("display: viewMode === 'masonry' ? 'block' : 'none'"), 'FilesAdminContent 仍在通过 display 切换瀑布流');
  assert(!content.includes("display: viewMode === 'list' ? 'block' : 'none'"), 'FilesAdminContent 仍在通过 display 切换列表');
  assert(content.includes('const sentinelRef = useRef(null);'), 'FilesAdminContent 未在内容区内部维护 sentinelRef');
  assert(content.includes('new IntersectionObserver((entries) => {'), 'FilesAdminContent 未使用 IntersectionObserver 增量渲染');
  assert(content.includes('Math.min(prev + renderStep, data.length)'), 'FilesAdminContent 未按步长递增可见数量');
  return { name: 'FilesAdminContent 使用单视图挂载与增量渲染', ok: true };
}

function testFilesAdminToolbarOwnsPathEditingState() {
  const toolbar = read('src/components/admin/FilesAdminToolbar.jsx');
  const page = read('src/pages/admin/FilesAdmin.jsx');

  assert(toolbar.includes('const [pathEditing, setPathEditing] = useState(false);'), 'FilesAdminToolbar 未接管路径编辑开关');
  assert(toolbar.includes("const [pathInput, setPathInput] = useState('');"), 'FilesAdminToolbar 未接管路径输入状态');
  assert(toolbar.includes('const pathInputRef = useRef(null);'), 'FilesAdminToolbar 未接管路径输入引用');
  assert(toolbar.includes('const commitPathEdit = () => {'), 'FilesAdminToolbar 缺少路径提交逻辑');
  assert(toolbar.includes('onNavigateToDir(normalized);'), 'FilesAdminToolbar 未在提交时触发目录跳转');

  assert(!page.includes('pathEditing'), 'FilesAdmin 页面仍保留路径编辑状态');
  assert(!page.includes('pathInput'), 'FilesAdmin 页面仍保留路径输入状态');
  assert(!page.includes('pathInputRef'), 'FilesAdmin 页面仍保留路径输入引用');
  assert(!page.includes('sentinelRef'), 'FilesAdmin 页面仍保留滚动哨兵引用');
  assert(page.includes('const breadcrumbs = useMemo('), 'FilesAdmin 页面缺少面包屑派生逻辑');
  return { name: '路径编辑状态已下沉到工具栏', ok: true };
}

function testUseFilesAdminCachesDirectoryData() {
  const hook = read('src/hooks/useFilesAdmin.js');
  const shared = read('src/admin/filesAdminShared.js');

  assert(hook.includes("} from '../admin/filesAdminShared';"), 'useFilesAdmin 未下沉共享辅助逻辑');
  assert(hook.includes('const cacheRef = useRef(new Map());'), 'useFilesAdmin 缺少目录缓存');
  assert(hook.includes('if (!forceReload && cached) {'), 'useFilesAdmin 未复用缓存目录数据');
  assert(hook.includes('cacheRef.current.set(cacheKey, nextList);'), 'useFilesAdmin 未写入目录缓存');
  assert(hook.includes('loadDirectoryData({ showLoading: true, forceReload: true, keepDirectories: true });'), 'useFilesAdmin 变更后刷新未复用目录数据');

  assert(shared.includes('export function getCacheKey(dir) {'), 'filesAdminShared 缺少目录缓存键生成逻辑');
  assert(shared.includes('export function buildDirectoryChildren(allDirs, dir) {'), 'filesAdminShared 缺少目录子级构建逻辑');
  assert(shared.includes('export async function fetchDirectories(currentDir) {'), 'filesAdminShared 缺少目录请求逻辑');
  assert(shared.includes('export async function fetchListPage(dir) {'), 'filesAdminShared 缺少文件列表请求逻辑');
  assert(shared.includes('export function updateCachedDirectories(cache, allDirs) {'), 'filesAdminShared 缺少缓存目录回填逻辑');
  return { name: 'useFilesAdmin 具备缓存与细粒度刷新边界', ok: true };
}

function testMasonryImageItemReducesInitialOverlayCost() {
  const item = read('src/components/admin/MasonryImageItem.jsx');
  const listView = read('src/components/admin/FilesAdminListView.jsx');

  assert(item.includes("const getImageSrc = (item) => `/${item.id}`;"), 'MasonryImageItem 未预留图片地址收口点');
  assert(item.includes('src={getImageSrc(item)}'), 'MasonryImageItem 未通过收口点生成原图地址');
  assert(item.includes('const [hovered, setHovered] = useState(false);'), 'MasonryImageItem 未使用悬浮态控制附加层');
  assert(item.includes('const showOverlay = hovered || isSelected;'), 'MasonryImageItem 未聚合附加层显示条件');
  assert(item.includes('{showOverlay && ('), 'MasonryImageItem 未按需挂载底部信息层');
  assert(!item.includes('Tooltip title="删除"'), 'MasonryImageItem 仍保留 Tooltip 包裹删除按钮');
  assert(listView.includes('src={`/${item.id}`}'), 'FilesAdminListView 预览图已不再保持原图地址');
  return { name: 'MasonryImageItem 压缩首屏附加层并保持原图地址', ok: true };
}

async function main() {
  const tests = [
    testFilesAdminContentUsesIncrementalRendering,
    testFilesAdminToolbarOwnsPathEditingState,
    testUseFilesAdminCachesDirectoryData,
    testMasonryImageItemReducesInitialOverlayCost,
  ];

  const results = [];
  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      console.log(`✓ ${result.name}`);
    } catch (error) {
      results.push({ name: test.name, ok: false, error });
      console.log(`✗ ${test.name}`);
      console.log(`  ${error.message}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log('');
  console.log(`结果: ${results.length - failed.length} 通过, ${failed.length} 失败, 共 ${results.length} 项`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
