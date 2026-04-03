/**
 * 自动修复引擎
 * 对标记 fixable 的规则执行自动修复，生成 patch 文件支持回滚
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ANSI 颜色码
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

export class Fixer {
  /**
   * @param {object} options
   * @param {boolean} options.dryRun 仅预览不写入
   * @param {boolean} options.color  是否着色输出
   */
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.color = options.color !== false;
  }

  /** 颜色包装 */
  _c(color, text) {
    return this.color ? `${color}${text}${C.reset}` : text;
  }

  /**
   * 执行自动修复
   * @param {object[]} files scanFiles 返回的文件列表
   * @param {object[]} rules 所有已注册规则
   * @param {string} rootDir 源码根目录（用于生成 patch 路径）
   * @returns {{ fixedFiles: number, totalChanges: number, patchPath: string|null }}
   */
  run(files, rules, rootDir) {
    const fixableRules = rules.filter(r => r.fixable && typeof r.fix === 'function');

    if (fixableRules.length === 0) {
      console.log(this._c(C.yellow, '  没有可自动修复的规则'));
      return { fixedFiles: 0, totalChanges: 0, patchPath: null };
    }

    // 收集所有修复
    const fileChanges = new Map(); // filePath -> { original, content, changes[] }

    for (const file of files) {
      let currentContent = file.content;
      const changes = [];

      for (const rule of fixableRules) {
        try {
          const result = rule.fix({
            ...file,
            content: currentContent,
            lines: currentContent.split('\n'),
          });
          if (result && result.content !== currentContent) {
            changes.push(...result.changes.map(c => ({
              ...c,
              rule: rule.code,
            })));
            currentContent = result.content;
          }
        } catch (err) {
          console.log(this._c(C.red, `  ✗ ${file.relativePath} [${rule.code}] 修复异常: ${err.message}`));
        }
      }

      if (changes.length > 0) {
        fileChanges.set(file.filePath, {
          relativePath: file.relativePath,
          original: file.content,
          content: currentContent,
          changes,
        });
      }
    }

    if (fileChanges.size === 0) {
      console.log(this._c(C.green, '  ✓ 没有需要修复的问题'));
      return { fixedFiles: 0, totalChanges: 0, patchPath: null };
    }

    // 生成统一 diff patch
    const patchLines = [];
    for (const [filePath, info] of fileChanges) {
      const relPath = info.relativePath;
      const oldLines = info.original.split('\n');
      const newLines = info.content.split('\n');
      patchLines.push(...this._generateUnifiedDiff(relPath, oldLines, newLines));
    }
    const patchContent = patchLines.join('\n') + '\n';

    // 保存 patch 文件
    let patchPath = null;
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const reportDir = path.resolve(scriptDir, '..', 'reports');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    patchPath = path.join(reportDir, `fix-${timestamp}.patch`);
    fs.writeFileSync(patchPath, patchContent, 'utf8');

    // 输出报告
    this._printReport(fileChanges, patchPath);

    // 写入修改（非 dry-run 模式）
    if (!this.dryRun) {
      for (const [filePath, info] of fileChanges) {
        fs.writeFileSync(filePath, info.content, 'utf8');
      }
    }

    const totalChanges = [...fileChanges.values()].reduce((sum, f) => sum + f.changes.length, 0);
    return {
      fixedFiles: fileChanges.size,
      totalChanges,
      patchPath,
    };
  }

  /** 输出修复报告 */
  _printReport(fileChanges, patchPath) {
    const W = 70;
    console.log('');
    console.log(this._c(C.bold, '╔' + '═'.repeat(W - 2) + '╗'));
    const title = this.dryRun ? '自动修复预览（dry-run）' : '自动修复报告';
    console.log(this._c(C.bold, '║') + this._center(title, W - 2) + this._c(C.bold, '║'));
    console.log(this._c(C.bold, '╚' + '═'.repeat(W - 2) + '╝'));
    console.log('');

    let totalChanges = 0;

    for (const [filePath, info] of fileChanges) {
      const icon = this.dryRun ? '~' : '✓';
      const iconColor = this.dryRun ? C.yellow : C.green;
      console.log(`  ${this._c(iconColor, icon)} ${this._c(C.cyan + C.bold, info.relativePath)}`);

      for (const change of info.changes) {
        const lineStr = change.line ? `行 ${String(change.line).padStart(4)}` : '       ';
        console.log(`    ${this._c(C.dim, lineStr)}  ${this._c(C.magenta, `[${change.rule}]`)} ${change.description}`);
      }
      totalChanges += info.changes.length;
      console.log('');
    }

    console.log(this._c(C.dim, '─'.repeat(W)));
    const mode = this.dryRun ? '预览' : '修复';
    console.log(`  ${mode}完成: ${this._c(C.bold, String(fileChanges.size))} 个文件, ${this._c(C.bold, String(totalChanges))} 处修改`);

    if (patchPath) {
      const relPatch = path.relative(process.cwd(), patchPath);
      console.log(`  差异文件: ${this._c(C.cyan, relPatch)}`);
      if (!this.dryRun) {
        console.log(`  回滚提示: ${this._c(C.yellow, '如需回滚，请在合适目录下对该 patch 执行反向应用')}`);
      }
    }
    console.log('');
  }

  /** 居中文本 */
  _center(text, width) {
    const textLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const pad = Math.max(0, Math.floor((width - textLen) / 2));
    const rightPad = Math.max(0, width - textLen - pad);
    return ' '.repeat(pad) + text + ' '.repeat(rightPad);
  }

  /**
   * 生成简化的统一 diff
   * 不使用外部工具，手动生成足够 git apply 使用的格式
   */
  _generateUnifiedDiff(relPath, oldLines, newLines) {
    const result = [];
    // 标准化路径为 posix
    const posixPath = relPath.replace(/\\/g, '/');
    result.push(`--- a/src/${posixPath}`);
    result.push(`+++ b/src/${posixPath}`);

    // 简单的逐行 diff（适用于小范围修改）
    const hunks = this._computeHunks(oldLines, newLines);
    for (const hunk of hunks) {
      result.push(`@@ -${hunk.oldStart + 1},${hunk.oldCount} +${hunk.newStart + 1},${hunk.newCount} @@`);
      for (const line of hunk.lines) {
        result.push(line);
      }
    }
    return result;
  }

  /** 计算 diff hunks */
  _computeHunks(oldLines, newLines) {
    // 使用 LCS 算法的简化版本生成行级差异
    const changes = [];
    let oi = 0, ni = 0;

    // 简单的顺序匹配
    while (oi < oldLines.length || ni < newLines.length) {
      if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
        changes.push({ type: 'same', old: oi, new: ni, text: oldLines[oi] });
        oi++;
        ni++;
      } else {
        // 向前搜索匹配点
        let foundOld = -1, foundNew = -1;
        const searchRange = 20;

        for (let d = 1; d <= searchRange; d++) {
          // 检查新文件中是否有匹配旧文件当前行
          if (foundNew === -1 && ni + d < newLines.length && oi < oldLines.length && newLines[ni + d] === oldLines[oi]) {
            foundNew = ni + d;
          }
          // 检查旧文件中是否有匹配新文件当前行
          if (foundOld === -1 && oi + d < oldLines.length && ni < newLines.length && oldLines[oi + d] === newLines[ni]) {
            foundOld = oi + d;
          }
          if (foundOld !== -1 || foundNew !== -1) break;
        }

        if (foundNew !== -1 && (foundOld === -1 || foundNew - ni <= foundOld - oi)) {
          // 新文件中有插入行
          while (ni < foundNew) {
            changes.push({ type: 'add', new: ni, text: newLines[ni] });
            ni++;
          }
        } else if (foundOld !== -1) {
          // 旧文件中有删除行
          while (oi < foundOld) {
            changes.push({ type: 'del', old: oi, text: oldLines[oi] });
            oi++;
          }
        } else {
          // 两边都无法匹配：替换
          if (oi < oldLines.length) {
            changes.push({ type: 'del', old: oi, text: oldLines[oi] });
            oi++;
          }
          if (ni < newLines.length) {
            changes.push({ type: 'add', new: ni, text: newLines[ni] });
            ni++;
          }
        }
      }
    }

    // 将 changes 分组为 hunks（连续变更 + 前后3行上下文）
    const hunks = [];
    let i = 0;
    const context = 3;

    while (i < changes.length) {
      // 找到下一个变更
      while (i < changes.length && changes[i].type === 'same') i++;
      if (i >= changes.length) break;

      // 确定 hunk 起始（包含上下文）
      let hunkStart = i;
      while (hunkStart > 0 && i - hunkStart < context && changes[hunkStart - 1].type === 'same') {
        hunkStart--;
      }

      // 找到 hunk 结束
      let hunkEnd = i;
      while (hunkEnd < changes.length) {
        if (changes[hunkEnd].type !== 'same') {
          hunkEnd++;
          continue;
        }
        // 检查后续是否有更多变更（合并间距小于 2*context 的 hunks）
        let nextChange = hunkEnd;
        while (nextChange < changes.length && changes[nextChange].type === 'same') nextChange++;
        if (nextChange >= changes.length || nextChange - hunkEnd > context * 2) {
          // 加上尾部上下文
          hunkEnd = Math.min(hunkEnd + context, changes.length);
          break;
        }
        hunkEnd = nextChange;
      }

      // 生成 hunk
      const hunkChanges = changes.slice(hunkStart, hunkEnd);
      let oldStart = 0, newStart = 0, oldCount = 0, newCount = 0;

      // 计算起始行号
      for (const c of hunkChanges) {
        if (c.type === 'same' || c.type === 'del') {
          if (oldCount === 0) oldStart = c.old;
          break;
        }
        if (c.type === 'add') {
          if (newCount === 0) newStart = c.new;
        }
      }
      for (const c of hunkChanges) {
        if (c.type === 'same' || c.type === 'del') {
          if (oldCount === 0) oldStart = c.old;
        }
        if (c.type === 'same' || c.type === 'add') {
          if (newCount === 0) newStart = c.new;
        }
        if (oldCount > 0 || newCount > 0) break;
      }

      // 重新计算起始位置
      oldStart = hunkChanges.find(c => c.old !== undefined)?.old ?? 0;
      newStart = hunkChanges.find(c => c.new !== undefined)?.new ?? 0;

      const lines = [];
      for (const c of hunkChanges) {
        if (c.type === 'same') {
          lines.push(` ${c.text}`);
          oldCount++;
          newCount++;
        } else if (c.type === 'del') {
          lines.push(`-${c.text}`);
          oldCount++;
        } else if (c.type === 'add') {
          lines.push(`+${c.text}`);
          newCount++;
        }
      }

      hunks.push({ oldStart, newStart, oldCount, newCount, lines });
      i = hunkEnd;
    }

    return hunks;
  }
}
