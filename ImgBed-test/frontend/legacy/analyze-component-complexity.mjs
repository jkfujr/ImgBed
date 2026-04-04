import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..', 'ImgBed-web', 'src');

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  // 统计状态数量（useState）
  const stateCount = (content.match(/useState\(/g) || []).length;

  // 统计 useEffect 数量
  const effectCount = (content.match(/useEffect\(/g) || []).length;

  // 统计事件处理函数（handle 开头）
  const handlerCount = (content.match(/const handle\w+|function handle\w+/g) || []).length;

  // 统计 import 语句数量
  const importCount = (content.match(/^import /gm) || []).length;

  // 统计 JSX 返回块数量（粗略估计组件复杂度）
  const returnCount = (content.match(/return \(/g) || []).length;

  // 计算复杂度分数（加权）
  const complexityScore =
    totalLines * 0.5 +
    stateCount * 10 +
    effectCount * 15 +
    handlerCount * 8 +
    importCount * 2;

  return {
    filePath,
    totalLines,
    stateCount,
    effectCount,
    handlerCount,
    importCount,
    returnCount,
    complexityScore: Math.round(complexityScore)
  };
}

function scanDirectory(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, results);
    } else if (entry.isFile() && (entry.name.endsWith('.jsx') || entry.name.endsWith('.js'))) {
      // 排除配置文件和工具文件
      if (!entry.name.includes('.config.') && !entry.name.includes('vite')) {
        try {
          const analysis = analyzeFile(fullPath);
          results.push(analysis);
        } catch (err) {
          console.error(`分析文件失败: ${fullPath}`, err.message);
        }
      }
    }
  }

  return results;
}

function run() {
  console.log('开始扫描组件复杂度...\n');

  const results = scanDirectory(rootDir);

  // 按复杂度分数排序
  results.sort((a, b) => b.complexityScore - a.complexityScore);

  console.log('=== 组件复杂度分析报告（按复杂度降序） ===\n');
  console.log('复杂度分数 = 总行数×0.5 + useState×10 + useEffect×15 + 处理函数×8 + import×2\n');

  // 显示前 20 个最复杂的文件
  const top20 = results.slice(0, 20);

  console.log('排名 | 复杂度 | 行数 | State | Effect | Handler | Import | 文件路径');
  console.log('-----|--------|------|-------|--------|---------|--------|----------');

  top20.forEach((item, index) => {
    const relativePath = path.relative(rootDir, item.filePath).replace(/\\/g, '/');
    console.log(
      `${String(index + 1).padStart(4)} | ` +
      `${String(item.complexityScore).padStart(6)} | ` +
      `${String(item.totalLines).padStart(4)} | ` +
      `${String(item.stateCount).padStart(5)} | ` +
      `${String(item.effectCount).padStart(6)} | ` +
      `${String(item.handlerCount).padStart(7)} | ` +
      `${String(item.importCount).padStart(6)} | ` +
      relativePath
    );
  });

  console.log('\n=== 高复杂度组件分析 ===\n');

  // 识别需要拆分的组件（复杂度 > 500 或 行数 > 300）
  const needRefactor = results.filter(r => r.complexityScore > 500 || r.totalLines > 300);

  if (needRefactor.length === 0) {
    console.log('未发现需要拆分的高复杂度组件。');
  } else {
    console.log(`发现 ${needRefactor.length} 个需要关注的高复杂度组件：\n`);

    needRefactor.forEach((item) => {
      const relativePath = path.relative(rootDir, item.filePath).replace(/\\/g, '/');
      console.log(`文件: ${relativePath}`);
      console.log(`  - 总行数: ${item.totalLines}`);
      console.log(`  - 状态数量: ${item.stateCount} (useState)`);
      console.log(`  - 副作用数量: ${item.effectCount} (useEffect)`);
      console.log(`  - 处理函数数量: ${item.handlerCount}`);
      console.log(`  - 复杂度分数: ${item.complexityScore}`);

      // 给出拆分建议
      const suggestions = [];
      if (item.stateCount > 10) {
        suggestions.push('状态过多，考虑提取自定义 hook 或拆分子组件');
      }
      if (item.effectCount > 5) {
        suggestions.push('副作用过多，考虑拆分为多个职责单一的组件');
      }
      if (item.handlerCount > 10) {
        suggestions.push('事件处理函数过多，考虑提取为独立的逻辑层');
      }
      if (item.totalLines > 400) {
        suggestions.push('文件行数过多，考虑按功能模块拆分');
      }

      if (suggestions.length > 0) {
        console.log('  建议:');
        suggestions.forEach(s => console.log(`    - ${s}`));
      }
      console.log('');
    });
  }

  console.log('=== 统计摘要 ===\n');
  console.log(`总文件数: ${results.length}`);
  console.log(`平均行数: ${Math.round(results.reduce((sum, r) => sum + r.totalLines, 0) / results.length)}`);
  console.log(`平均复杂度: ${Math.round(results.reduce((sum, r) => sum + r.complexityScore, 0) / results.length)}`);
  console.log(`需要关注的高复杂度组件: ${needRefactor.length}`);
}

run();
