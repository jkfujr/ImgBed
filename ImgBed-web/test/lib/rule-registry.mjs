/**
 * 规则注册与执行框架
 *
 * 规则接口约定:
 * {
 *   code: 'B01',
 *   name: '规则名称',
 *   category: 'bug',
 *   severity: 'warning',
 *   description: '规则描述',
 *   check(file, reporter) { ... }
 * }
 *
 * file = { filePath, relativePath, content, lines }
 */

export class RuleRegistry {
  constructor() {
    this.rules = [];
  }

  /** 注册单条规则 */
  register(rule) {
    this.rules.push(rule);
  }

  /** 批量注册 */
  registerAll(rules) {
    for (const rule of rules) {
      this.rules.push(rule);
    }
  }

  /**
   * 对文件列表执行所有已注册规则
   * @param {object[]} files scanFiles 返回的文件列表
   * @param {Reporter} reporter 报告器
   * @param {object} options 过滤选项
   * @param {string[]} options.ruleFilter 仅运行指定规则码
   * @param {string[]} options.categoryFilter 仅运行指定类别
   * @param {string} options.fileGlob 文件名匹配模式
   */
  run(files, reporter, options = {}) {
    const { ruleFilter, categoryFilter, fileGlob } = options;

    // 过滤规则
    let activeRules = this.rules;
    if (ruleFilter && ruleFilter.length > 0) {
      const set = new Set(ruleFilter.map(r => r.toUpperCase()));
      activeRules = activeRules.filter(r => set.has(r.code));
    }
    if (categoryFilter && categoryFilter.length > 0) {
      const cats = new Set(categoryFilter.map(c => c.toUpperCase()));
      activeRules = activeRules.filter(r => cats.has(r.code.charAt(0)));
    }

    // 过滤文件
    let activeFiles = files;
    if (fileGlob) {
      const pattern = globToRegex(fileGlob);
      activeFiles = files.filter(f => pattern.test(f.relativePath));
    }

    // 执行规则
    for (const rule of activeRules) {
      for (const file of activeFiles) {
        try {
          rule.check(file, reporter);
        } catch (err) {
          reporter.add({
            file: file.relativePath,
            line: 0,
            col: 0,
            rule: rule.code,
            severity: 'error',
            message: `规则执行异常: ${err.message}`,
          });
        }
      }
    }
  }

  /** 获取所有已注册规则的信息 */
  listRules() {
    return this.rules.map(r => ({
      code: r.code,
      name: r.name,
      category: r.category,
      severity: r.severity,
      description: r.description,
      fixable: !!r.fixable,
    }));
  }
}

/**
 * 简易 glob 转正则
 * 支持 * 和 **
 */
function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(escaped);
}
