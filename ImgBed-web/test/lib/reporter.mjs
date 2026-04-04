/**
 * 输出格式化模块
 * 按文件分组展示诊断信息，支持 ANSI 着色、分类汇总和 JSON 输出
 */

// ANSI 颜色码
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

const SEVERITY_COLORS = {
  error: COLORS.red,
  warning: COLORS.yellow,
  info: COLORS.blue,
};

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

const CAT_LABELS = {
  S: '风格 (Style)',
  B: '缺陷 (Bug)',
  C: '复杂度 (Complexity)',
  P: '性能 (Performance)',
  A: '架构 (Architecture)',
  U: '冗余 (Unused)',
};

export class Reporter {
  constructor(options = {}) {
    this.diagnostics = [];
    this.useColor = options.color !== false;
    this.minSeverity = options.severity || 'info';
  }

  /** 颜色包装 */
  _c(color, text) {
    return this.useColor ? `${color}${text}${COLORS.reset}` : text;
  }

  /** 添加诊断 */
  add({ file, line = 0, col = 0, rule, severity, message }) {
    if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[this.minSeverity]) return;
    this.diagnostics.push({ file, line, col, rule, severity, message });
  }

  /** 是否有 error 级别问题 */
  hasErrors() {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  /**
   * 输出完整详细报告
   * 包含：标题 → 按文件分组的详细问题 → 按类别汇总 → 按规则统计 → 问题最多文件排行 → 总计
   */
  printFullReport(totalFiles, ruleList) {
    const W = 70; // 报告宽度

    // ── 报告标题 ──
    console.log('');
    console.log(this._c(COLORS.bold, '╔' + '═'.repeat(W - 2) + '╗'));
    console.log(this._c(COLORS.bold, '║') + this._center('ImgBed-web 代码检测报告', W - 2) + this._c(COLORS.bold, '║'));
    console.log(this._c(COLORS.bold, '╚' + '═'.repeat(W - 2) + '╝'));
    console.log(this._c(COLORS.dim, `  扫描时间: ${new Date().toLocaleString('zh-CN')}  |  规则数: ${ruleList.length}  |  文件数: ${totalFiles}`));

    if (this.diagnostics.length === 0) {
      console.log('');
      console.log(this._c(COLORS.green, '  ✓ 检测完成：未发现任何问题。'));
      console.log('');
      return;
    }

    // ── 第 1 部分：按文件分组的详细问题列表 ──
    console.log('');
    this._printSection('详细问题列表');

    const groups = new Map();
    for (const d of this.diagnostics) {
      if (!groups.has(d.file)) groups.set(d.file, []);
      groups.get(d.file).push(d);
    }

    for (const [file, items] of groups) {
      items.sort((a, b) => a.line - b.line || a.col - b.col);
      console.log(`\n  ${this._c(COLORS.bold + COLORS.cyan, file)}  ${this._c(COLORS.dim, `(${items.length} 个问题)`)}`);
      for (const d of items) {
        const loc = `${String(d.line).padStart(4)}:${String(d.col).padEnd(3)}`;
        const severityColor = SEVERITY_COLORS[d.severity] || COLORS.dim;
        const ruleTag = this._c(COLORS.magenta, d.rule);
        const severityTag = this._c(severityColor, d.severity.padEnd(7));
        console.log(`    ${this._c(COLORS.dim, loc)}  ${ruleTag} ${severityTag}  ${d.message}`);
      }
    }

    // ── 第 2 部分：按类别汇总 ──
    console.log('');
    this._printSection('按类别汇总');

    const byCategory = {};
    const byCategorySeverity = {};
    for (const d of this.diagnostics) {
      const cat = d.rule.charAt(0);
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (!byCategorySeverity[cat]) byCategorySeverity[cat] = { error: 0, warning: 0, info: 0 };
      byCategorySeverity[cat][d.severity]++;
    }

    // 表头
    console.log('');
    console.log(this._c(COLORS.bold,
      '    类别                     合计    error   warning   info'));
    console.log('    ' + '─'.repeat(60));

    const catOrder = ['B', 'A', 'C', 'S', 'P', 'U'];
    for (const cat of catOrder) {
      if (!byCategory[cat]) continue;
      const label = `${cat}  ${CAT_LABELS[cat] || cat}`;
      const s = byCategorySeverity[cat];
      const total = byCategory[cat];
      const errorStr = s.error > 0 ? this._c(COLORS.red, String(s.error).padStart(5)) : '    0';
      const warnStr = s.warning > 0 ? this._c(COLORS.yellow, String(s.warning).padStart(7)) : '      0';
      const infoStr = s.info > 0 ? this._c(COLORS.blue, String(s.info).padStart(6)) : '     0';
      console.log(`    ${label.padEnd(25)} ${String(total).padStart(5)}    ${errorStr}   ${warnStr}   ${infoStr}`);
    }

    // ── 第 3 部分：按规则统计 ──
    console.log('');
    this._printSection('按规则统计');

    const byRule = {};
    for (const d of this.diagnostics) {
      byRule[d.rule] = (byRule[d.rule] || 0) + 1;
    }

    // 按数量降序排列
    const sortedRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]);

    console.log('');
    console.log(this._c(COLORS.bold,
      '    规则    数量  级别     描述'));
    console.log('    ' + '─'.repeat(60));

    const ruleMap = new Map();
    for (const r of ruleList) ruleMap.set(r.code, r);

    for (const [code, count] of sortedRules) {
      const info = ruleMap.get(code);
      const severity = info ? info.severity : '?';
      const description = info ? info.name : '';
      const severityColor = SEVERITY_COLORS[severity] || COLORS.dim;
      console.log(
        `    ${this._c(COLORS.magenta, code.padEnd(6))}  ${String(count).padStart(4)}  ${this._c(severityColor, severity.padEnd(7))}  ${description}`
      );
    }

    // ── 第 4 部分：问题最多文件 TOP 10 ──
    console.log('');
    this._printSection('问题最多文件 TOP 10');

    const sortedFiles = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    console.log('');
    for (let i = 0; i < sortedFiles.length; i++) {
      const [file, items] = sortedFiles[i];
      const errors = items.filter(d => d.severity === 'error').length;
      const warnings = items.filter(d => d.severity === 'warning').length;
      const infos = items.filter(d => d.severity === 'info').length;

      const rank = String(i + 1).padStart(2);
      const bar = this._makeBar(items.length, sortedFiles[0][1].length);
      const detail = [];
      if (errors > 0) detail.push(this._c(COLORS.red, `${errors}E`));
      if (warnings > 0) detail.push(this._c(COLORS.yellow, `${warnings}W`));
      if (infos > 0) detail.push(this._c(COLORS.blue, `${infos}I`));

      console.log(`    ${this._c(COLORS.dim, rank + '.')} ${file}`);
      console.log(`        ${bar}  ${items.length} 个问题  [${detail.join(' ')}]`);
    }

    // ── 第 5 部分：总计 ──
    const counts = { error: 0, warning: 0, info: 0 };
    for (const d of this.diagnostics) {
      counts[d.severity] = (counts[d.severity] || 0) + 1;
    }
    const affectedFiles = groups.size;

    console.log('');
    console.log('╔' + '═'.repeat(W - 2) + '╗');

    const summaryLine = `扫描 ${totalFiles} 个文件，${affectedFiles} 个文件存在问题，共 ${this.diagnostics.length} 个问题`;
    console.log('║' + this._center(summaryLine, W - 2) + '║');

    const levelLine =
      `error: ${counts.error}  |  warning: ${counts.warning}  |  info: ${counts.info}`;
    console.log('║' + this._center(levelLine, W - 2) + '║');

    console.log('╚' + '═'.repeat(W - 2) + '╝');
    console.log('');
  }

  /** 打印分隔标题 */
  _printSection(title) {
    console.log(this._c(COLORS.bold, `  ── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`));
  }

  /** 生成柱状图 */
  _makeBar(count, max) {
    const maxWidth = 20;
    const width = Math.max(1, Math.round((count / max) * maxWidth));
    return this._c(COLORS.green, '█'.repeat(width)) + this._c(COLORS.dim, '░'.repeat(maxWidth - width));
  }

  /** 居中文本（纯文本宽度计算） */
  _center(text, width) {
    const textLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const pad = Math.max(0, Math.floor((width - textLen) / 2));
    const rightPad = Math.max(0, width - textLen - pad);
    return ' '.repeat(pad) + text + ' '.repeat(rightPad);
  }

  /**
   * 生成 Markdown 格式报告
   * @param {number} totalFiles 扫描文件总数
   * @param {object[]} ruleList 规则列表
   * @param {object} externalChecks 外部静态检查结果
   * @returns {string} Markdown 文本
   */
  toMarkdown(totalFiles, ruleList, externalChecks = null) {
    const now = new Date().toLocaleString('zh-CN');
    const lines = [];

    // 统计数据准备
    const counts = { error: 0, warning: 0, info: 0 };
    const byCategory = {};
    const byCategorySeverity = {};
    const byRule = {};
    const groups = new Map();

    for (const d of this.diagnostics) {
      counts[d.severity]++;
      const cat = d.rule.charAt(0);
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (!byCategorySeverity[cat]) byCategorySeverity[cat] = { error: 0, warning: 0, info: 0 };
      byCategorySeverity[cat][d.severity]++;
      byRule[d.rule] = (byRule[d.rule] || 0) + 1;
      if (!groups.has(d.file)) groups.set(d.file, []);
      groups.get(d.file).push(d);
    }

    const affectedFiles = groups.size;
    const ruleMap = new Map();
    for (const r of ruleList) ruleMap.set(r.code, r);

    // ── 标题 ──
    lines.push('# ImgBed-web 代码检测报告');
    lines.push('');
    lines.push(`> 扫描时间: ${now}  `);
    lines.push(`> 规则数: ${ruleList.length} | 扫描文件: ${totalFiles} | 问题文件: ${affectedFiles} | 总问题数: ${this.diagnostics.length}`);
    lines.push('');

    if (this.diagnostics.length === 0) {
      lines.push('**检测完成：未发现任何问题。**');
      lines.push('');

      if (externalChecks && externalChecks.checks && externalChecks.checks.length > 0) {
        lines.push('---');
        lines.push('');
        lines.push('## 外部静态检查');
        lines.push('');
        lines.push('| 检查项 | 状态 | 说明 |');
        lines.push('|--------|------|------|');
        for (const check of externalChecks.checks) {
          if (check.skipped) {
            lines.push(`| ${check.name} | ⊘ 已跳过 | ${check.skipReason} |`);
          } else if (check.passed) {
            lines.push(`| ${check.name} | ✓ 通过 | - |`);
          } else {
            lines.push(`| ${check.name} | ✗ 失败 | 退出码: ${check.exitCode} |`);
          }
        }
        lines.push('');

        // 输出失败检查的详细错误信息
        for (const check of externalChecks.checks) {
          if (!check.skipped && !check.passed && check.output) {
            lines.push(`### ${check.name} 详细输出`);
            lines.push('');
            lines.push('```');
            lines.push(check.output);
            lines.push('```');
            lines.push('');
          }
        }
      }

      lines.push('---');
      lines.push(`*由 ImgBed-web 代码检测工具自动生成*`);
      return lines.join('\n');
    }

    // ── 总览 ──
    lines.push('## 总览');
    lines.push('');
    lines.push('| 级别 | 数量 | 占比 |');
    lines.push('|------|------|------|');
    for (const level of ['error', 'warning', 'info']) {
      const icon = level === 'error' ? '🔴' : level === 'warning' ? '🟡' : '🔵';
      const pct = this.diagnostics.length > 0
        ? (counts[level] / this.diagnostics.length * 100).toFixed(1)
        : '0.0';
      lines.push(`| ${icon} ${level} | ${counts[level]} | ${pct}% |`);
    }
    lines.push('');

    // ── 按类别汇总 ──
    lines.push('## 按类别汇总');
    lines.push('');
    lines.push('| 类别 | 合计 | error | warning | info |');
    lines.push('|------|------|-------|---------|------|');

    const catOrder = ['B', 'A', 'C', 'S', 'P', 'U'];
    for (const cat of catOrder) {
      if (!byCategory[cat]) continue;
      const s = byCategorySeverity[cat];
      lines.push(`| **${cat}** ${CAT_LABELS[cat] || cat} | ${byCategory[cat]} | ${s.error} | ${s.warning} | ${s.info} |`);
    }
    lines.push('');

    // ── 按规则统计 ──
    lines.push('## 按规则统计');
    lines.push('');
    lines.push('| 规则 | 数量 | 级别 | 描述 |');
    lines.push('|------|------|------|------|');

    const sortedRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
    for (const [code, count] of sortedRules) {
      const info = ruleMap.get(code);
      const severity = info ? info.severity : '?';
      const name = info ? info.name : '';
      const desc = info ? info.description : '';
      lines.push(`| \`${code}\` | ${count} | ${severity} | ${name} — ${desc} |`);
    }
    lines.push('');

    // ── 问题最多文件 TOP 10 ──
    lines.push('## 问题最多文件 TOP 10');
    lines.push('');
    lines.push('| # | 文件 | 问题数 | error | warning | info |');
    lines.push('|---|------|--------|-------|---------|------|');

    const sortedFiles = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    for (let i = 0; i < sortedFiles.length; i++) {
      const [file, items] = sortedFiles[i];
      const e = items.filter(d => d.severity === 'error').length;
      const w = items.filter(d => d.severity === 'warning').length;
      const inf = items.filter(d => d.severity === 'info').length;
      lines.push(`| ${i + 1} | \`${file}\` | ${items.length} | ${e} | ${w} | ${inf} |`);
    }
    lines.push('');

    // ── 详细问题列表 ──
    lines.push('## 详细问题列表');
    lines.push('');

    for (const [file, items] of groups) {
      items.sort((a, b) => a.line - b.line || a.col - b.col);
      lines.push(`### \`${file}\` (${items.length} 个问题)`);
      lines.push('');
      lines.push('| 位置 | 规则 | 级别 | 说明 |');
      lines.push('|------|------|------|------|');
      for (const d of items) {
        const loc = `${d.line}:${d.col}`;
        const icon = d.severity === 'error' ? '🔴' : d.severity === 'warning' ? '🟡' : '🔵';
        lines.push(`| ${loc} | \`${d.rule}\` | ${icon} ${d.severity} | ${d.message} |`);
      }
      lines.push('');
    }

    // ── 规则说明索引 ──
    lines.push('## 规则说明索引');
    lines.push('');
    lines.push('| 规则 | 级别 | 名称 | 描述 |');
    lines.push('|------|------|------|------|');
    for (const cat of catOrder) {
      for (const r of ruleList) {
        if (r.code.charAt(0) !== cat) continue;
        lines.push(`| \`${r.code}\` | ${r.severity} | ${r.name} | ${r.description} |`);
      }
    }
    lines.push('');
    lines.push('---');

    // ── 外部静态检查 ──
    if (externalChecks && externalChecks.checks && externalChecks.checks.length > 0) {
      lines.push('');
      lines.push('## 外部静态检查');
      lines.push('');
      lines.push('| 检查项 | 状态 | 说明 |');
      lines.push('|--------|------|------|');
      for (const check of externalChecks.checks) {
        if (check.skipped) {
          lines.push(`| ${check.name} | ⊘ 已跳过 | ${check.skipReason} |`);
        } else if (check.passed) {
          lines.push(`| ${check.name} | ✓ 通过 | - |`);
        } else {
          lines.push(`| ${check.name} | ✗ 失败 | 退出码: ${check.exitCode} |`);
        }
      }
      lines.push('');

      // 输出失败检查的详细错误信息
      for (const check of externalChecks.checks) {
        if (!check.skipped && !check.passed && check.output) {
          lines.push(`### ${check.name} 详细输出`);
          lines.push('');
          lines.push('```');
          lines.push(check.output);
          lines.push('```');
          lines.push('');
        }
      }

      lines.push('---');
    }

    lines.push(`*由 ImgBed-web 代码检测工具自动生成*`);

    return lines.join('\n');
  }

  /** 结构化 JSON 输出 */
  toJSON(totalFiles) {
    const counts = { error: 0, warning: 0, info: 0 };
    const byCategory = {};
    const byRule = {};
    for (const d of this.diagnostics) {
      counts[d.severity] = (counts[d.severity] || 0) + 1;
      const cat = d.rule.charAt(0);
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      byRule[d.rule] = (byRule[d.rule] || 0) + 1;
    }

    return {
      summary: {
        filesScanned: totalFiles,
        filesAffected: new Set(this.diagnostics.map(d => d.file)).size,
        totalIssues: this.diagnostics.length,
        byLevel: counts,
        byCategory,
        byRule,
      },
      diagnostics: this.diagnostics,
    };
  }
}
