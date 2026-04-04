/**
 * 分析当前报告中 error 级别问题的准确性
 */

console.log('=== 复杂度问题分析 ===\n');

// 1. system.js PUT /config (44.0)
console.log('1. system.js PUT /config (评分 44.0)');
console.log('   - 54-116 行，共 63 行');
console.log('   - 1 个 await (readSystemConfig)');
console.log('   - 最大嵌套 5 层（body.upload 下的多个 if）');
console.log('   - 问题：大量重复的 cfg.upload = cfg.upload || {} 模式');
console.log('   - 建议：抽取 updateUploadConfig(cfg, body.upload) 函数');
console.log('   - 优化潜力：可降至 warning 级别\n');

// 2. system.js PUT /storages/:id (48.0)
console.log('2. system.js PUT /storages/:id (评分 48.0)');
console.log('   - 353-401 行，共 49 行');
console.log('   - 3 个 await (readSystemConfig, updateStorageChannelMeta, applyStorageConfigChange)');
console.log('   - 最大嵌套 4 层');
console.log('   - 问题：大量字段逐一更新逻辑');
console.log('   - 建议：抽取 applyStorageFieldUpdates(existing, body) 函数');
console.log('   - 优化潜力：可降至 warning 级别\n');

// 3. system.js GET /quota-stats (35.0)
console.log('3. system.js GET /quota-stats (评分 35.0)');
console.log('   - 477-544 行，共 68 行');
console.log('   - 1 个 await (db.selectFrom)');
console.log('   - 最大嵌套 6 层（mode=always 分支内的多层循环和条件）');
console.log('   - 问题：always 模式的统计逻辑过于复杂');
console.log('   - 建议：抽取 calculateQuotaStatsFromDB(db, configPath) 函数');
console.log('   - 优化潜力：可降至 warning 级别\n');

// 4. api-tokens.js POST / (37.0)
console.log('4. api-tokens.js POST / (评分 37.0)');
console.log('   - 51-113 行，共 63 行');
console.log('   - 3 个 await (insertInto, selectFrom)');
console.log('   - 最大嵌套 6 层（多层 if 校验）');
console.log('   - 问题：校验逻辑、token 生成、DB 操作混在一起');
console.log('   - 建议：抽取 validateTokenInput(body) 和 createTokenRecord(body) 函数');
console.log('   - 优化潜力：可降至 warning 级别\n');

// 5. view.js GET /:id (35.0)
console.log('5. view.js GET /:id (评分 35.0)');
console.log('   - 51-125 行，共 75 行');
console.log('   - 3 个 await (db.selectFrom, ChunkManager.getChunks, storage.getStream)');
console.log('   - 最大嵌套 5 层');
console.log('   - 问题：已经抽取了 3 个服务函数，但主流程仍然较长');
console.log('   - 分析：chunked 和普通流是两条完全不同的分支');
console.log('   - 建议：抽取 handleChunkedStream() 和 handleRegularStream() 函数');
console.log('   - 优化潜力：可降至 warning 级别\n');

// 6. A03 架构规则
console.log('6. A03 架构规则 (system.js)');
console.log('   - 规则描述：system.js 应显式写回 config.json 配置文件');
console.log('   - 当前状态：已使用 writeSystemConfig() 和 applyStorageConfigChange()');
console.log('   - 分析：规则可能需要更新，或者需要更明确的写回模式');
console.log('   - 建议：先优化其他 5 个 error，再评估此规则是否准确\n');

console.log('=== 优化优先级建议 ===\n');
console.log('优先级 1: system.js PUT /config (44.0)');
console.log('  - 收益：降低最高复杂度热点');
console.log('  - 风险：低（纯字段更新逻辑）');
console.log('  - 工作量：小（抽取 1 个函数）\n');

console.log('优先级 2: system.js PUT /storages/:id (48.0)');
console.log('  - 收益：降低第二高复杂度热点');
console.log('  - 风险：低（纯字段更新逻辑）');
console.log('  - 工作量：小（抽取 1 个函数）\n');

console.log('优先级 3: system.js GET /quota-stats (35.0)');
console.log('  - 收益：降低统计逻辑复杂度');
console.log('  - 风险：中（涉及业务统计逻辑）');
console.log('  - 工作量：中（抽取 1 个函数 + 测试）\n');

console.log('优先级 4: api-tokens.js POST / (37.0)');
console.log('  - 收益：降低 token 创建复杂度');
console.log('  - 风险：低（校验和创建逻辑分离）');
console.log('  - 工作量：小（抽取 2 个函数）\n');

console.log('优先级 5: view.js GET /:id (35.0)');
console.log('  - 收益：进一步降低已优化路由的复杂度');
console.log('  - 风险：中（涉及流处理核心逻辑）');
console.log('  - 工作量：中（抽取 2 个函数 + 测试）\n');

console.log('=== 结论 ===');
console.log('报告准确性：✓ 所有 error 级别问题均真实存在');
console.log('优化可行性：✓ 所有问题都可通过服务层抽取降至 warning');
console.log('推荐方案：按优先级 1→2→3→4→5 顺序优化');
console.log('预期成果：error 数量从 6 降至 1（仅剩 A03）');
