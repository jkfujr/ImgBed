import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultReportPath = path.resolve(scriptDir, '..', '..', '..', '.docs', 'localhost_5173-20260404T053631.json');
const reportsDir = path.join(scriptDir, 'reports');

const INVESTIGATION_MAP = {
  images: {
    priority: 'P1',
    title: '图片体积与重复加载排查',
    actions: [
      '检查首屏是否一次性渲染了过多图片，优先控制初始可见数量。',
      '检查同一图片 URL 是否被重复请求或重复渲染。',
      '确认图片是否存在超大原图直出，优先补压缩图、缩略图或尺寸分级。',
    ],
    files: [
      'src/components/admin/MasonryImageItem.jsx',
      'src/components/admin/FilesAdminContent.jsx',
      'src/pages/admin/FilesAdmin.jsx',
    ],
  },
  mainThread: {
    priority: 'P1',
    title: '首屏渲染与主线程阻塞排查',
    actions: [
      '检查文件页首屏是否同步做了过多列表计算、布局计算或事件绑定。',
      '检查瀑布流与列表视图是否在首屏同时参与渲染或准备。',
      '优先梳理页面初始化链路，确认哪些逻辑可以延后到首屏之后。',
    ],
    files: [
      'src/pages/admin/FilesAdmin.jsx',
      'src/components/admin/FilesAdminContent.jsx',
    ],
  },
  lcp: {
    priority: 'P2',
    title: 'LCP 与首屏可见区域排查',
    actions: [
      '优先检查页面头部和首屏可见区域是否被主线程阻塞。',
      '确认首屏标题、工具栏和首批图片是否被后续渲染任务挤压。',
    ],
    files: [
      'src/pages/admin/FilesAdmin.jsx',
      'src/components/admin/FilesAdminContent.jsx',
    ],
  },
  noise: {
    priority: 'P3',
    title: '开发环境噪声识别',
    actions: [
      '区分项目自身资源、Vite 开发资源、浏览器扩展和不可归因来源。',
      '后续若要做严格性能对比，应优先使用无扩展的生产构建环境复测。',
    ],
    files: [],
  },
};

const REVIEW_TARGETS = [
  'src/pages/admin/FilesAdmin.jsx',
  'src/components/admin/FilesAdminContent.jsx',
  'src/components/admin/MasonryImageItem.jsx',
];

function formatNumber(value, digits = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'N/A';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatMs(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'N/A';
  if (value >= 1000) return `${formatNumber(value / 1000, 2)} s`;
  return `${formatNumber(value, 0)} ms`;
}

function formatBytes(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'N/A';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex++;
  }
  const digits = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${formatNumber(current, digits)} ${units[unitIndex]}`;
}

function formatScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'N/A';
  return `${Math.round(score * 100)}`;
}

function formatIsoTime(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
}

function readReport(reportPath) {
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function readSourceFile(relativePath) {
  const absolutePath = path.resolve(scriptDir, '..', relativePath);
  return {
    relativePath,
    absolutePath,
    content: fs.readFileSync(absolutePath, 'utf8'),
  };
}

function getAudit(report, id) {
  return report.audits?.[id] || null;
}

function simplifyUrl(url) {
  if (!url) return 'N/A';
  return url.replace(/^https?:\/\//, '');
}

function classifySource(url) {
  if (!url) return 'unknown';
  if (url === 'Unattributable') return 'unattributable';
  if (url.startsWith('chrome-extension://')) return 'extension';
  if (url.includes('/@vite/') || url.includes('/node_modules/.vite/') || url.includes('/@react-refresh')) return 'vite';
  if (url.startsWith('http://localhost:5173/')) return 'project';
  return 'other';
}

function pickTopItems(items, valueKey, limit = 5) {
  if (!Array.isArray(items)) return [];
  return [...items]
    .filter(item => typeof item?.[valueKey] === 'number')
    .sort((a, b) => b[valueKey] - a[valueKey])
    .slice(0, limit);
}

function extractMeta(report, reportPath) {
  return {
    reportPath,
    requestedUrl: report.requestedUrl || 'N/A',
    finalUrl: report.finalUrl || 'N/A',
    fetchTime: formatIsoTime(report.fetchTime),
    mode: report.gatherMode || 'N/A',
    formFactor: report.configSettings?.formFactor || report.formFactor || 'N/A',
    lighthouseVersion: report.lighthouseVersion || 'N/A',
    performanceScore: report.categories?.performance?.score ?? null,
    benchmarkIndex: report.environment?.benchmarkIndex ?? null,
  };
}

function extractMetrics(report) {
  const metricIds = [
    ['FCP', 'first-contentful-paint'],
    ['LCP', 'largest-contentful-paint'],
    ['Speed Index', 'speed-index'],
    ['TBT', 'total-blocking-time'],
    ['CLS', 'cumulative-layout-shift'],
    ['TTI', 'interactive'],
  ];

  return metricIds.map(([label, id]) => {
    const audit = getAudit(report, id);
    return {
      label,
      id,
      title: audit?.title || label,
      displayValue: audit?.displayValue || null,
      numericValue: audit?.numericValue ?? null,
      score: audit?.score ?? null,
    };
  });
}

function extractSignals(report) {
  const mainThread = getAudit(report, 'mainthread-work-breakdown');
  const bootup = getAudit(report, 'bootup-time');
  const totalByteWeight = getAudit(report, 'total-byte-weight');
  const resourceSummary = getAudit(report, 'resource-summary');
  const diagnostics = getAudit(report, 'diagnostics');
  const lcpElement = getAudit(report, 'largest-contentful-paint-element');

  const resourceItems = resourceSummary?.details?.items || [];
  const imageSummary = resourceItems.find(item => item.resourceType === 'image') || null;
  const totalSummary = resourceItems.find(item => item.resourceType === 'total') || null;
  const diagnosticsItem = diagnostics?.details?.items?.[0] || null;
  const lcpElementNode = lcpElement?.details?.items?.find(item => item.type === 'table' && item.headings?.some(h => h.key === 'node'))?.items?.[0]?.node || null;
  const lcpPhaseItems = lcpElement?.details?.items?.find(item => item.type === 'table' && item.headings?.some(h => h.key === 'phase'))?.items || [];
  const renderDelay = lcpPhaseItems.find(item => item.phase === 'Render Delay') || null;

  const bootupItems = (bootup?.details?.items || []).map(item => ({
    url: item.url,
    simplifiedUrl: simplifyUrl(item.url),
    total: item.total ?? 0,
    scripting: item.scripting ?? 0,
    sourceType: classifySource(item.url),
  }));

  const byteWeightItems = (totalByteWeight?.details?.items || []).map(item => ({
    url: item.url,
    simplifiedUrl: simplifyUrl(item.url),
    totalBytes: item.totalBytes ?? 0,
    sourceType: classifySource(item.url),
  }));

  const sourceBreakdown = {
    project: bootupItems.filter(item => item.sourceType === 'project').length,
    vite: bootupItems.filter(item => item.sourceType === 'vite').length,
    extension: bootupItems.filter(item => item.sourceType === 'extension').length,
    unattributable: bootupItems.filter(item => item.sourceType === 'unattributable').length,
  };

  return {
    mainThread: {
      total: mainThread?.numericValue ?? null,
      displayValue: mainThread?.displayValue || null,
      topGroups: pickTopItems(mainThread?.details?.items, 'duration', 4).map(item => ({
        label: item.groupLabel || item.group || '未知分类',
        duration: item.duration,
      })),
    },
    javascript: {
      total: bootup?.numericValue ?? null,
      displayValue: bootup?.displayValue || null,
      topSources: pickTopItems(bootupItems, 'total', 5),
      sourceBreakdown,
    },
    network: {
      totalBytes: totalByteWeight?.numericValue ?? null,
      totalDisplayValue: totalByteWeight?.displayValue || null,
      totalRequests: diagnosticsItem?.numRequests ?? null,
      imageRequests: imageSummary?.requestCount ?? null,
      imageBytes: imageSummary?.transferSize ?? null,
      imageRatio: imageSummary && totalSummary && totalSummary.transferSize > 0
        ? imageSummary.transferSize / totalSummary.transferSize
        : null,
      topAssets: pickTopItems(byteWeightItems, 'totalBytes', 5),
    },
    lcp: {
      elementLabel: lcpElementNode?.nodeLabel || null,
      elementSnippet: lcpElementNode?.snippet || null,
      selector: lcpElementNode?.selector || null,
      renderDelay: renderDelay?.timing ?? null,
      phases: lcpPhaseItems.map(item => ({
        phase: item.phase,
        timing: item.timing,
        percent: item.percent,
      })),
    },
    diagnostics: diagnosticsItem ? {
      numRequests: diagnosticsItem.numRequests,
      numTasksOver50ms: diagnosticsItem.numTasksOver50ms,
      totalTaskTime: diagnosticsItem.totalTaskTime,
    } : null,
  };
}

function buildIssue(id, title, score, displayValue, summary, details) {
  return { id, title, score, displayValue, summary, details };
}

function extractRisks(signals) {
  return [
    {
      key: 'images',
      priority: INVESTIGATION_MAP.images.priority,
      title: INVESTIGATION_MAP.images.title,
      evidence: [
        `图片请求数: ${formatNumber(signals.network.imageRequests)}`,
        `图片体积: ${formatBytes(signals.network.imageBytes)}`,
        `图片体积占比: ${signals.network.imageRatio == null ? 'N/A' : `${formatNumber(signals.network.imageRatio * 100, 1)}%`}`,
      ],
    },
    {
      key: 'mainThread',
      priority: INVESTIGATION_MAP.mainThread.priority,
      title: INVESTIGATION_MAP.mainThread.title,
      evidence: [
        `主线程总耗时: ${formatMs(signals.mainThread.total)}`,
        `长任务数（>50ms）: ${formatNumber(signals.diagnostics?.numTasksOver50ms)}`,
        `JS 执行耗时: ${formatMs(signals.javascript.total)}`,
      ],
    },
    {
      key: 'lcp',
      priority: INVESTIGATION_MAP.lcp.priority,
      title: INVESTIGATION_MAP.lcp.title,
      evidence: [
        `LCP 元素: ${signals.lcp.elementLabel || 'N/A'}`,
        `LCP Render Delay: ${formatMs(signals.lcp.renderDelay)}`,
        `LCP 选择器: ${signals.lcp.selector || 'N/A'}`,
      ],
    },
    {
      key: 'noise',
      priority: INVESTIGATION_MAP.noise.priority,
      title: INVESTIGATION_MAP.noise.title,
      evidence: [
        `Vite 开发资源来源数: ${formatNumber(signals.javascript.sourceBreakdown.vite)}`,
        `浏览器扩展来源数: ${formatNumber(signals.javascript.sourceBreakdown.extension)}`,
        `不可归因来源数: ${formatNumber(signals.javascript.sourceBreakdown.unattributable)}`,
      ],
    },
  ];
}

function extractIssues(report, signals) {
  const mainThread = getAudit(report, 'mainthread-work-breakdown');
  const bootup = getAudit(report, 'bootup-time');
  const totalByteWeight = getAudit(report, 'total-byte-weight');

  return [
    buildIssue(
      'total-byte-weight',
      totalByteWeight?.title || 'Avoid enormous network payloads',
      totalByteWeight?.score ?? null,
      totalByteWeight?.displayValue || formatBytes(signals.network.totalBytes),
      '网络体积过大，且图片资源占比极高，应优先处理首屏大图和重复图片加载。',
      signals.network.topAssets.map(item => ({
        label: `${item.simplifiedUrl} [${item.sourceType}]`,
        value: formatBytes(item.totalBytes),
      }))
    ),
    buildIssue(
      'mainthread-work-breakdown',
      mainThread?.title || 'Minimize main-thread work',
      mainThread?.score ?? null,
      mainThread?.displayValue || formatMs(signals.mainThread.total),
      '主线程长时间被脚本执行与渲染任务占用，首屏交互和稳定展示都会被拖慢。',
      signals.mainThread.topGroups.map(item => ({
        label: item.label,
        value: formatMs(item.duration),
      }))
    ),
    buildIssue(
      'bootup-time',
      bootup?.title || 'Reduce JavaScript execution time',
      bootup?.score ?? null,
      bootup?.displayValue || formatMs(signals.javascript.total),
      'JS 执行成本偏高，开发环境资源与项目首屏逻辑共同放大了启动成本。',
      signals.javascript.topSources.map(item => ({
        label: `${item.simplifiedUrl} [${item.sourceType}]`,
        value: `${formatMs(item.total)}（脚本执行 ${formatMs(item.scripting)}）`,
      }))
    ),
  ];
}

function buildInvestigationChecklist(signals) {
  return [
    {
      priority: INVESTIGATION_MAP.images.priority,
      type: INVESTIGATION_MAP.images.title,
      evidence: [
        `图片体积 ${formatBytes(signals.network.imageBytes)}，约占总传输体积 ${signals.network.imageRatio == null ? 'N/A' : `${formatNumber(signals.network.imageRatio * 100, 1)}%`}`,
        `最大图片资源集中在 ${signals.network.topAssets.slice(0, 3).map(item => simplifyUrl(item.url)).join('、')}`,
      ],
      actions: INVESTIGATION_MAP.images.actions,
      files: INVESTIGATION_MAP.images.files,
    },
    {
      priority: INVESTIGATION_MAP.mainThread.priority,
      type: INVESTIGATION_MAP.mainThread.title,
      evidence: [
        `主线程总耗时 ${formatMs(signals.mainThread.total)}`,
        `Script Evaluation 为 ${formatMs(signals.mainThread.topGroups[0]?.duration ?? null)}`,
        `长任务数 ${formatNumber(signals.diagnostics?.numTasksOver50ms)}`,
      ],
      actions: INVESTIGATION_MAP.mainThread.actions,
      files: INVESTIGATION_MAP.mainThread.files,
    },
    {
      priority: INVESTIGATION_MAP.lcp.priority,
      type: INVESTIGATION_MAP.lcp.title,
      evidence: [
        `LCP 元素为 ${signals.lcp.elementLabel || 'N/A'}`,
        `Render Delay 为 ${formatMs(signals.lcp.renderDelay)}`,
      ],
      actions: INVESTIGATION_MAP.lcp.actions,
      files: INVESTIGATION_MAP.lcp.files,
    },
    {
      priority: INVESTIGATION_MAP.noise.priority,
      type: INVESTIGATION_MAP.noise.title,
      evidence: [
        `Vite 资源 ${formatNumber(signals.javascript.sourceBreakdown.vite)} 项`,
        `浏览器扩展 ${formatNumber(signals.javascript.sourceBreakdown.extension)} 项`,
        `不可归因 ${formatNumber(signals.javascript.sourceBreakdown.unattributable)} 项`,
      ],
      actions: INVESTIGATION_MAP.noise.actions,
      files: INVESTIGATION_MAP.noise.files,
    },
  ];
}

function createSuspiciousPoint({ title, severity, observation, evidence, impact, suggestion, relatedAudit }) {
  return { title, severity, observation, evidence, impact, suggestion, relatedAudit };
}

function buildFileReviews(signals) {
  const files = REVIEW_TARGETS.map(readSourceFile);
  const filesMap = new Map(files.map(file => [file.relativePath, file.content]));
  const topImageUrl = simplifyUrl(signals.network.topAssets[0]?.url || '');

  const filesAdminContent = filesMap.get('src/components/admin/FilesAdminContent.jsx') || '';
  const filesAdmin = filesMap.get('src/pages/admin/FilesAdmin.jsx') || '';
  const masonryImageItem = filesMap.get('src/components/admin/MasonryImageItem.jsx') || '';

  return [
    {
      file: 'src/pages/admin/FilesAdmin.jsx',
      summary: '页面入口承担列数计算、视图切换、路径编辑和多个对话框状态，是 /admin/files 的首屏总装配点。',
      suspiciousPoints: [
        createSuspiciousPoint({
          title: '页面入口聚合状态较多',
          severity: 'medium',
          observation: 'FilesAdmin 同时维护 viewMode、pathEditing、pathInput，以及删除、迁移、详情等业务状态入口。',
          evidence: `Lighthouse 显示主线程总耗时 ${formatMs(signals.mainThread.total)}，而该文件是当前页面首屏入口。`,
          impact: '入口组件更新范围偏大时，首屏和交互阶段更容易放大无关子树的重渲染。',
          suggestion: '优先审查哪些状态属于首屏必须，哪些可继续下沉到子组件或延后初始化。',
          relatedAudit: 'mainthread-work-breakdown',
        }),
        createSuspiciousPoint({
          title: '列数与视图逻辑集中在首屏入口',
          severity: 'medium',
          observation: '该文件负责断点列数计算、视图模式切换，并将结果直接传给内容区。',
          evidence: `Lighthouse 的 JS 执行耗时为 ${formatMs(signals.javascript.total)}，列表页初始化逻辑越集中，启动成本越高。`,
          impact: '页面初始化时可能把布局计算与内容装配放在同一层，增加首屏准备成本。',
          suggestion: '后续可重点确认列数计算、视图切换和内容区装配是否需要完全同步发生。',
          relatedAudit: 'bootup-time',
        }),
      ],
    },
    {
      file: 'src/components/admin/FilesAdminContent.jsx',
      summary: '内容区当前同时挂载瀑布流和列表两套视图，仅用 display 控制显示，是主线程与首屏渲染的高优先级可疑点。',
      suspiciousPoints: [
        createSuspiciousPoint({
          title: '同时挂载 Masonry 与 List 两套视图',
          severity: 'high',
          observation: '组件中两个视图都被渲染，只通过 Box 的 display 在视觉上隐藏。',
          evidence: `源码包含 viewMode === 'masonry' ? 'block' : 'none' 与 viewMode === 'list' ? 'block' : 'none' 两组容器；Lighthouse 主线程耗时 ${formatMs(signals.mainThread.total)}。`,
          impact: '非当前视图仍可能参与 React 树构建与子组件计算，放大首屏渲染和切换成本。',
          suggestion: '优先确认是否可以只挂载当前视图，而不是同时保留两套完整树。',
          relatedAudit: 'mainthread-work-breakdown',
        }),
        createSuspiciousPoint({
          title: '内容区直接承接全量数据渲染入口',
          severity: 'high',
          observation: '当前组件把 directories 与 data 直接传入瀑布流 / 列表视图，未在这一层做首屏裁剪。',
          evidence: `图片请求数 ${formatNumber(signals.network.imageRequests)}，图片体积 ${formatBytes(signals.network.imageBytes)}，且 FilesAdminMasonryView 会继续对 data 全量 map。`,
          impact: '如果首屏数据量较大，内容区会成为图片加载与列表渲染放大的共同入口。',
          suggestion: '后续优先检查是否需要在内容区层面限制首屏展示数量或拆分加载批次。',
          relatedAudit: 'total-byte-weight',
        }),
      ],
    },
    {
      file: 'src/components/admin/MasonryImageItem.jsx',
      summary: '瀑布流单项直接请求真实图片资源，并叠加 hover、overlay、checkbox、tooltip 等交互层，是图片体积与单项渲染成本的核心观察点。',
      suspiciousPoints: [
        createSuspiciousPoint({
          title: '直接请求真实图片地址',
          severity: 'high',
          observation: '组件使用 src={`/${item.id}`} 直接加载图片资源，没有在该层体现缩略图或尺寸分级。',
          evidence: `Lighthouse 最大图片资源达到 ${formatBytes(signals.network.topAssets[0]?.totalBytes ?? null)}，当前最大资源为 ${topImageUrl}。`,
          impact: '即使设置了 loading="lazy"，首屏可见图片较多时仍会集中触发大图加载。',
          suggestion: '优先检查该组件对应接口是否支持缩略图、预览图或按尺寸返回。',
          relatedAudit: 'total-byte-weight',
        }),
        createSuspiciousPoint({
          title: '单项交互层较多',
          severity: 'medium',
          observation: '每个图片项同时包含 hover 缩放、overlay 控件、Checkbox、Tooltip、IconButton 和日期文本。',
          evidence: `Lighthouse 显示 Script Evaluation ${formatMs(signals.mainThread.topGroups[0]?.duration ?? null)}，瀑布流场景下单项结构越重，累计成本越明显。`,
          impact: '单项成本在数量放大后会堆叠到主线程与布局阶段。',
          suggestion: '后续可重点检查首屏首批可见项是否需要完整挂载全部交互层。',
          relatedAudit: 'mainthread-work-breakdown',
        }),
      ],
    },
  ].map((review) => ({
    ...review,
    contentSample: review.file === 'src/components/admin/FilesAdminContent.jsx'
      ? filesAdminContent
      : review.file === 'src/pages/admin/FilesAdmin.jsx'
        ? filesAdmin
        : masonryImageItem,
  }));
}

function extractAnalysis(report) {
  const signals = extractSignals(report);
  const risks = extractRisks(signals);
  const issues = extractIssues(report, signals);
  const investigationChecklist = buildInvestigationChecklist(signals);
  const fileReviews = buildFileReviews(signals);
  const conclusions = [
    `图片请求 ${formatNumber(signals.network.imageRequests)} 个，体积 ${formatBytes(signals.network.imageBytes)}，是当前最直接的性能压力来源。`,
    `主线程总耗时 ${formatMs(signals.mainThread.total)}，其中脚本执行与列表渲染链路值得优先排查。`,
    `LCP 主要耗在 Render Delay（${formatMs(signals.lcp.renderDelay)}），说明渲染阻塞比资源发现更关键。`,
  ];
  const recommendations = [
    '先压缩首屏大图并控制初始渲染图片数量。',
    '优先审查 FilesAdmin 页面首屏是否同步渲染了过多内容。',
    '对 Vite 开发资源和浏览器扩展噪声单独标记，不要直接等同为项目问题。',
  ];

  return { signals, risks, issues, investigationChecklist, fileReviews, conclusions, recommendations };
}

function buildEvidenceSummary(analysis) {
  return [
    { label: '主线程总耗时', value: formatMs(analysis.signals.mainThread.total) },
    { label: 'JS 执行耗时', value: formatMs(analysis.signals.javascript.total) },
    { label: '长任务数（>50ms）', value: formatNumber(analysis.signals.diagnostics?.numTasksOver50ms) },
    { label: '总请求数', value: formatNumber(analysis.signals.diagnostics?.numRequests) },
    { label: '总传输体积', value: formatBytes(analysis.signals.network.totalBytes) },
    { label: '图片体积占比', value: analysis.signals.network.imageRatio == null ? 'N/A' : `${formatNumber(analysis.signals.network.imageRatio * 100, 1)}%` },
    { label: 'LCP 元素', value: analysis.signals.lcp.elementLabel || 'N/A' },
    { label: 'LCP Render Delay', value: formatMs(analysis.signals.lcp.renderDelay) },
  ];
}

function buildMarkdown(meta, metrics, analysis) {
  const evidenceSummary = buildEvidenceSummary(analysis);
  const lines = [];
  lines.push('# Lighthouse 性能分析报告');
  lines.push('');
  lines.push('## 报告摘要');
  lines.push('');
  lines.push(`- 报告文件: ${meta.reportPath}`);
  lines.push(`- 页面: ${meta.finalUrl}`);
  lines.push(`- 请求地址: ${meta.requestedUrl}`);
  lines.push(`- 抓取时间: ${meta.fetchTime}`);
  lines.push(`- 模式: ${meta.mode}`);
  lines.push(`- 设备: ${meta.formFactor}`);
  lines.push(`- Lighthouse 版本: ${meta.lighthouseVersion}`);
  lines.push(`- Performance 分数: ${formatScore(meta.performanceScore)}`);
  lines.push('');
  lines.push('## 证据摘要');
  lines.push('');
  for (const item of evidenceSummary) lines.push(`- ${item.label}: ${item.value}`);
  lines.push('');
  lines.push('## 核心指标');
  lines.push('');
  lines.push('| 指标 | 显示值 | 原始值 | 分数 |');
  lines.push('| --- | --- | --- | --- |');
  for (const metric of metrics) {
    const rawValue = metric.id === 'cumulative-layout-shift' ? formatNumber(metric.numericValue ?? 0, 2) : formatMs(metric.numericValue);
    lines.push(`| ${metric.label} | ${metric.displayValue || 'N/A'} | ${rawValue} | ${formatScore(metric.score)} |`);
  }
  lines.push('');
  lines.push('## 风险优先级');
  lines.push('');
  for (const risk of analysis.risks) {
    lines.push(`- ${risk.priority} ${risk.title}`);
    for (const evidence of risk.evidence) lines.push(`  - ${evidence}`);
  }
  lines.push('');
  lines.push('## 主要问题');
  lines.push('');
  for (const issue of analysis.issues) {
    lines.push(`### ${issue.id} — ${issue.title}`);
    lines.push('');
    lines.push(`- Lighthouse 值: ${issue.displayValue || 'N/A'}`);
    lines.push(`- 分数: ${formatScore(issue.score)}`);
    lines.push(`- 结论: ${issue.summary}`);
    lines.push('- 主要来源:');
    for (const item of issue.details) lines.push(`  - ${item.label}: ${item.value}`);
    lines.push('');
  }
  lines.push('## 代码排查清单');
  lines.push('');
  for (const item of analysis.investigationChecklist) {
    lines.push(`### ${item.priority} ${item.type}`);
    lines.push('');
    lines.push('- 证据:');
    for (const evidence of item.evidence) lines.push(`  - ${evidence}`);
    lines.push('- 建议动作:');
    for (const action of item.actions) lines.push(`  - ${action}`);
    if (item.files.length > 0) {
      lines.push('- 相关代码文件:');
      for (const file of item.files) lines.push(`  - ${file}`);
    }
    lines.push('');
  }
  lines.push('## 可疑点逐项审查报告');
  lines.push('');
  for (const review of analysis.fileReviews) {
    lines.push(`### ${review.file}`);
    lines.push('');
    lines.push(`- 文件摘要: ${review.summary}`);
    for (const point of review.suspiciousPoints) {
      lines.push('');
      lines.push(`#### ${point.title}`);
      lines.push('');
      lines.push(`- 等级: ${point.severity}`);
      lines.push(`- 观察: ${point.observation}`);
      lines.push(`- 关联证据: ${point.evidence}`);
      lines.push(`- 可能影响: ${point.impact}`);
      lines.push(`- 建议排查方向: ${point.suggestion}`);
      lines.push(`- 关联审计项: ${point.relatedAudit}`);
    }
    lines.push('');
  }
  lines.push('## 结论与建议');
  lines.push('');
  for (const item of analysis.conclusions) lines.push(`- ${item}`);
  for (const item of analysis.recommendations) lines.push(`- 建议: ${item}`);
  lines.push('- 开发环境噪声说明: 本报告包含 Vite 开发资源、浏览器扩展和不可归因来源，排查时应优先聚焦项目自身资源。');
  lines.push('');
  return lines.join('\n');
}

function printReport(meta, metrics, analysis) {
  const evidenceSummary = buildEvidenceSummary(analysis);
  console.log('Lighthouse 性能分析报告');
  console.log('='.repeat(60));
  console.log(`报告文件: ${meta.reportPath}`);
  console.log(`页面: ${meta.finalUrl}`);
  console.log(`请求地址: ${meta.requestedUrl}`);
  console.log(`抓取时间: ${meta.fetchTime}`);
  console.log(`模式: ${meta.mode}`);
  console.log(`设备: ${meta.formFactor}`);
  console.log(`Performance 分数: ${formatScore(meta.performanceScore)}`);
  console.log('');
  console.log('证据摘要');
  console.log('-'.repeat(60));
  for (const item of evidenceSummary) console.log(`- ${item.label}: ${item.value}`);
  console.log('');
  console.log('核心指标');
  console.log('-'.repeat(60));
  for (const metric of metrics) {
    const rawValue = metric.id === 'cumulative-layout-shift' ? formatNumber(metric.numericValue ?? 0, 2) : formatMs(metric.numericValue);
    console.log(`- ${metric.label}: ${metric.displayValue || 'N/A'} | 原始值 ${rawValue} | 分数 ${formatScore(metric.score)}`);
  }
  console.log('');
  console.log('风险优先级');
  console.log('-'.repeat(60));
  for (const risk of analysis.risks) {
    console.log(`- ${risk.priority} ${risk.title}`);
    for (const evidence of risk.evidence) console.log(`  - ${evidence}`);
  }
  console.log('');
  console.log('主要问题');
  console.log('-'.repeat(60));
  for (const issue of analysis.issues) {
    console.log(`- ${issue.id}: ${issue.title}`);
    console.log(`  值: ${issue.displayValue || 'N/A'} | 分数: ${formatScore(issue.score)}`);
    console.log(`  结论: ${issue.summary}`);
    for (const item of issue.details) console.log(`  - ${item.label}: ${item.value}`);
  }
  console.log('');
  console.log('代码排查清单');
  console.log('-'.repeat(60));
  for (const item of analysis.investigationChecklist) {
    console.log(`- ${item.priority} ${item.type}`);
    for (const evidence of item.evidence) console.log(`  证据: ${evidence}`);
    for (const action of item.actions) console.log(`  动作: ${action}`);
    for (const file of item.files) console.log(`  文件: ${file}`);
  }
  console.log('');
  console.log('源码审查摘要');
  console.log('-'.repeat(60));
  for (const review of analysis.fileReviews) {
    console.log(`- ${review.file}`);
    console.log(`  摘要: ${review.summary}`);
    for (const point of review.suspiciousPoints.filter(item => item.severity === 'high')) {
      console.log(`  高优先级可疑点: ${point.title}`);
    }
  }
  console.log('');
  console.log('结论与建议');
  console.log('-'.repeat(60));
  for (const item of analysis.conclusions) console.log(`- ${item}`);
  for (const item of analysis.recommendations) console.log(`- 建议: ${item}`);
  console.log('- 开发环境噪声说明: 本报告包含 Vite 开发资源、浏览器扩展和不可归因来源，排查时应优先聚焦项目自身资源。');
  console.log('');
}

function writeReport(markdown) {
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportsDir, `lighthouse-analysis-${timestamp}.md`);
  const latestPath = path.join(reportsDir, 'lighthouse-analysis-latest.md');
  fs.writeFileSync(reportPath, markdown, 'utf8');
  fs.writeFileSync(latestPath, markdown, 'utf8');
  return { reportPath, latestPath };
}

export function analyzeLighthouseReport(inputPath = defaultReportPath) {
  const absolutePath = path.resolve(inputPath);
  const report = readReport(absolutePath);
  const meta = extractMeta(report, absolutePath);
  const metrics = extractMetrics(report);
  const analysis = extractAnalysis(report);
  const markdown = buildMarkdown(meta, metrics, analysis);
  const output = writeReport(markdown);
  return { meta, metrics, analysis, markdown, output };
}

export function runCli(inputPath = process.argv[2] || defaultReportPath) {
  const result = analyzeLighthouseReport(inputPath);
  printReport(result.meta, result.metrics, result.analysis);
  console.log(`Markdown 报告: ${result.output.reportPath}`);
  console.log(`最新报告: ${result.output.latestPath}`);
  return result;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    runCli();
  } catch (error) {
    console.error('Lighthouse 报告分析失败:', error.message);
    process.exit(1);
  }
}
