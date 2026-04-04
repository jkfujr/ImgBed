import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const testRoot = path.join(repoRoot, 'ImgBed-test');
const analyzerPath = path.join(testRoot, 'frontend', 'analyze-lighthouse-report.mjs');
const reportJsonPath = path.resolve(repoRoot, '.docs', 'localhost_5173-20260404T053631.json');
const latestReportPath = path.join(testRoot, 'frontend', 'reports', 'lighthouse-analysis-latest.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testAnalyzerGeneratesDetailedReport() {
  const mod = await import(pathToFileURL(analyzerPath).href);
  assert(typeof mod.analyzeLighthouseReport === 'function', '分析脚本未导出 analyzeLighthouseReport');

  const result = mod.analyzeLighthouseReport(reportJsonPath);
  assert(result.meta.finalUrl === 'http://localhost:5173/admin/files', '页面地址提取错误');
  assert(result.meta.mode === 'navigation', '模式提取错误');
  assert(result.meta.formFactor === 'desktop', '设备提取错误');
  assert(result.meta.performanceScore === 0.34, 'Performance 分数提取错误');

  assert(result.analysis.signals, '缺少结构化 signals');
  assert(result.analysis.risks, '缺少结构化 risks');
  assert(result.analysis.investigationChecklist, '缺少代码排查清单');
  assert(result.analysis.fileReviews, '缺少源码审查报告');
  assert(result.analysis.fileReviews.length === 3, '源码审查目标文件数量不正确');
  assert(result.analysis.signals.network.imageRatio > 0.9, '图片体积占比提取错误');
  assert(result.analysis.investigationChecklist.some(item => item.files.includes('src/pages/admin/FilesAdmin.jsx')), '排查清单缺少 FilesAdmin.jsx');
  assert(result.analysis.investigationChecklist.some(item => item.files.includes('src/components/admin/FilesAdminContent.jsx')), '排查清单缺少 FilesAdminContent.jsx');
  assert(result.analysis.investigationChecklist.some(item => item.files.includes('src/components/admin/MasonryImageItem.jsx')), '排查清单缺少 MasonryImageItem.jsx');
  assert(result.analysis.fileReviews.some(item => item.file === 'src/pages/admin/FilesAdmin.jsx'), '源码审查缺少 FilesAdmin.jsx');
  assert(result.analysis.fileReviews.some(item => item.file === 'src/components/admin/FilesAdminContent.jsx'), '源码审查缺少 FilesAdminContent.jsx');
  assert(result.analysis.fileReviews.some(item => item.file === 'src/components/admin/MasonryImageItem.jsx'), '源码审查缺少 MasonryImageItem.jsx');

  const contentReview = result.analysis.fileReviews.find(item => item.file === 'src/components/admin/FilesAdminContent.jsx');
  const imageReview = result.analysis.fileReviews.find(item => item.file === 'src/components/admin/MasonryImageItem.jsx');
  const pageReview = result.analysis.fileReviews.find(item => item.file === 'src/pages/admin/FilesAdmin.jsx');
  assert(contentReview.suspiciousPoints.some(item => item.title.includes('同时挂载 Masonry 与 List 两套视图')), '缺少内容区双视图可疑点');
  assert(imageReview.suspiciousPoints.some(item => item.title.includes('直接请求真实图片地址')), '缺少图片直出可疑点');
  assert(pageReview.suspiciousPoints.some(item => item.title.includes('页面入口聚合状态较多')), '缺少页面入口状态聚合可疑点');

  assert(result.markdown.includes('证据摘要'), 'Markdown 未输出证据摘要');
  assert(result.markdown.includes('代码排查清单'), 'Markdown 未输出代码排查清单');
  assert(result.markdown.includes('可疑点逐项审查报告'), 'Markdown 未输出可疑点逐项审查报告');
  assert(result.markdown.includes('同时挂载 Masonry 与 List 两套视图'), 'Markdown 未包含内容区可疑点');
  assert(result.markdown.includes('直接请求真实图片地址'), 'Markdown 未包含图片直出可疑点');
  assert(result.markdown.includes('页面入口聚合状态较多'), 'Markdown 未包含页面入口可疑点');
  assert(result.markdown.includes('开发环境噪声说明'), 'Markdown 未输出噪声说明');

  assert(fs.existsSync(result.output.reportPath), '未生成时间戳报告');
  assert(fs.existsSync(result.output.latestPath), '未生成 latest 报告');
  assert(fs.existsSync(latestReportPath), 'latest 报告文件不存在');

  const latestContent = fs.readFileSync(latestReportPath, 'utf8');
  assert(latestContent.includes('Lighthouse 性能分析报告'), 'latest 报告标题错误');
  assert(latestContent.includes('可疑点逐项审查报告'), 'latest 报告缺少逐项审查章节');

  return { name: '分析脚本可输出逐项源码审查报告', ok: true };
}

async function main() {
  const tests = [testAnalyzerGeneratesDetailedReport];
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

  const failed = results.filter(item => !item.ok);
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
