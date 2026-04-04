/**
 * 输出格式化模块
 * 按文件分组展示诊断信息，支持 ANSI 着色、分类汇总和 JSON 输出
 */

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
    this.suiteName = options.suiteName || 'ImgBed 代码检测报告';
    this.footerName = options.footerName || 'ImgBed 代码检测工具';
  }

  _c(color, text) {
    return this.useColor ? `${color}${text}${COLORS.reset}` : text;
  }

  add({ file, line = 0, col = 0, rule, severity, message }) {
    if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[this.minSeverity]) return;
    this.diagnostics.push({ file, line, col, rule, severity, message });
  }

  hasErrors() {
    return this.diagnostics.some((d) => d.severity === 'error');
  }

  printFullReport(totalFiles, ruleList) {
    const W = 70;

    console.log('');
    console.log(this._c(COLORS.bold, '╔' + '═'.repeat(W - 2) + '╗'));
    console.log(this._c(COLORS.bold, '║') + this._center(this.suiteName, W - 2) + this._c(COLORS.bold, '║'));
    console.log(this._c(COLORS.bold, '╚' + '═'.repeat(W - 2) + '╝'));
    console.log(this._c(COLORS.dim, `  扫描时间: ${new Date().toLocaleString('zh-CN')}  |  规则数: ${ruleList.length}  |  文件数: ${totalFiles}`));

    if (this.diagnostics.length === 0) {
      console.log('');
      console.log(this._c(COLORS.green, '  ✓ 检测完成：未发现任何问题。'));
      console.log('');
      return;
    }

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
        console.log(`    ${this._c(COLORS.dim, loc)}  ${this._c(COLORS.magenta, d.rule)} ${this._c(severityColor, d.severity.padEnd(7))}  ${d.message}`);
      }
    }

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

    console.log('');
    console.log(this._c(COLORS.bold, '    类别                     合计    error   warning   info'));
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

    console.log('');
    this._printSection('按规则统计');
    const byRule = {};
    for (const d of this.diagnostics) {
      byRule[d.rule] = (byRule[d.rule] || 0) + 1;
    }
    const sortedRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
    const ruleMap = new Map();
    for (const r of ruleList) ruleMap.set(r.code, r);

    console.log('');
    console.log(this._c(COLORS.bold, '    规则    数量  级别     描述'));
    console.log('    ' + '─'.repeat(60));
    for (const [code, count] of sortedRules) {
      const info = ruleMap.get(code);
      const severity = info ? info.severity : '?';
      const description = info ? info.name : '';
      console.log(`    ${this._c(COLORS.magenta, code.padEnd(6))}  ${String(count).padStart(4)}  ${this._c(SEVERITY_COLORS[severity] || COLORS.dim, severity.padEnd(7))}  ${description}`);
    }

    const counts = { error: 0, warning: 0, info: 0 };
    for (const d of this.diagnostics) {
      counts[d.severity] = (counts[d.severity] || 0) + 1;
    }
    const affectedFiles = groups.size;

    console.log('');
    console.log('╔' + '═'.repeat(W - 2) + '╗');
    console.log('║' + this._center(`扫描 ${totalFiles} 个文件，${affectedFiles} 个文件存在问题，共 ${this.diagnostics.length} 个问题`, W - 2) + '║');
    console.log('║' + this._center(`error: ${counts.error}  |  warning: ${counts.warning}  |  info: ${counts.info}`, W - 2) + '║');
    console.log('╚' + '═'.repeat(W - 2) + '╝');
    console.log('');
  }

  _printSection(title) {
    console.log(this._c(COLORS.bold, `  ── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`));
  }

  _center(text, width) {
    const textLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const pad = Math.max(0, Math.floor((width - textLen) / 2));
    const rightPad = Math.max(0, width - textLen - pad);
    return ' '.repeat(pad) + text + ' '.repeat(rightPad);
  }

  toMarkdown(totalFiles, ruleList, externalChecks = null) {
    const now = new Date().toLocaleString('zh-CN');
    const lines = [];
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
    const catOrder = ['B', 'A', 'C', 'S', 'P', 'U'];

    lines.push(`# ${this.suiteName}`);
    lines.push('');
    lines.push(`> 扫描时间: ${now}  `);
    lines.push(`> 规则数: ${ruleList.length} | 扫描文件: ${totalFiles} | 问题文件: ${affectedFiles} | 总问题数: ${this.diagnostics.length}`);
    lines.push('');

    if (this.diagnostics.length === 0) {
      lines.push('**检测完成：未发现任何问题。**');
      lines.push('');
      this._appendExternalChecks(lines, externalChecks);
      lines.push('---');
      lines.push(`*由 ${this.footerName} 自动生成*`);
      return lines.join('\n');
    }

    lines.push('## 总览');
    lines.push('');
    lines.push('| 级别 | 数量 | 占比 |');
    lines.push('|------|------|------|');
    for (const level of ['error', 'warning', 'info']) {
      const pct = this.diagnostics.length > 0 ? (counts[level] / this.diagnostics.length * 100).toFixed(1) : '0.0';
      lines.push(`| ${level} | ${counts[level]} | ${pct}% |`);
    }
    lines.push('');

    lines.push('## 按类别汇总');
    lines.push('');
    lines.push('| 类别 | 合计 | error | warning | info |');
    lines.push('|------|------|-------|---------|------|');
    for (const cat of catOrder) {
      if (!byCategory[cat]) continue;
      const s = byCategorySeverity[cat];
      lines.push(`| **${cat}** ${CAT_LABELS[cat] || cat} | ${byCategory[cat]} | ${s.error} | ${s.warning} | ${s.info} |`);
    }
    lines.push('');

    lines.push('## 按规则统计');
    lines.push('');
    lines.push('| 规则 | 数量 | 级别 | 描述 |');
    lines.push('|------|------|------|------|');
    const sortedRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
    for (const [code, count] of sortedRules) {
      const info = ruleMap.get(code);
      lines.push(`| \`${code}\` | ${count} | ${info ? info.severity : '?'} | ${info ? info.name : ''} — ${info ? info.description : ''} |`);
    }
    lines.push('');

    lines.push('## 详细问题列表');
    lines.push('');
    for (const [file, items] of groups) {
      items.sort((a, b) => a.line - b.line || a.col - b.col);
      lines.push(`### \`${file}\` (${items.length} 个问题)`);
      lines.push('');
      lines.push('| 位置 | 规则 | 级别 | 说明 |');
      lines.push('|------|------|------|------|');
      for (const d of items) {
        lines.push(`| ${d.line}:${d.col} | \`${d.rule}\` | ${d.severity} | ${d.message} |`);
      }
      lines.push('');
    }

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

    this._appendExternalChecks(lines, externalChecks);
    lines.push('---');
    lines.push(`*由 ${this.footerName} 自动生成*`);
    return lines.join('\n');
  }

  _appendExternalChecks(lines, externalChecks) {
    if (!externalChecks || !externalChecks.checks || externalChecks.checks.length === 0) {
      return;
    }

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
        filesAffected: new Set(this.diagnostics.map((d) => d.file)).size,
        totalIssues: this.diagnostics.length,
        byLevel: counts,
        byCategory,
        byRule,
      },
      diagnostics: this.diagnostics,
    };
  }
}
