const storageManager = require('../src/storage/manager');
const { db } = require('../src/database');

async function testQuotaPersistence() {
    console.log('--- 开始验证容量快照持久化与启动恢复逻辑 ---');

    try {
        // 1. 模拟全量校正并持久化
        console.log('\n1. 触发全量容量校正...');
        await storageManager._rebuildAllQuotaStats();

        const statsBefore = storageManager.getAllQuotaStats();
        console.log('当前内存中的容量统计:', statsBefore);

        // 2. 验证数据库中是否有记录
        const latestRecords = await db
            .selectFrom('storage_quota_history')
            .select(['storage_id', 'used_bytes'])
            .orderBy('id', 'desc')
            .limit(5)
            .execute();

        console.log('\n2. 数据库中的最新记录:', latestRecords);
        if (latestRecords.length === 0) {
            throw new Error('数据库中没有找到容量记录！');
        }

        // 3. 验证启动加载逻辑
        // 手动清除内存缓存，模拟重启后的状态加载
        console.log('\n3. 模拟系统重启：清除内存缓存并从数据库重新加载...');
        storageManager.quotaCache.clear();
        console.log('清除后内存统计:', storageManager.getAllQuotaStats());

        await storageManager._loadQuotaFromHistory();
        const statsAfter = storageManager.getAllQuotaStats();
        console.log('重新加载后内存统计:', statsAfter);

        // 4. 比对结果
        let match = true;
        for (const [id, bytes] of Object.entries(statsBefore)) {
            if (statsAfter[id] !== bytes) {
                console.error(`不匹配: 渠道 ${id} 原本为 ${bytes}, 重载后为 ${statsAfter[id]}`);
                match = false;
            }
        }

        if (match && Object.keys(statsBefore).length > 0) {
            console.log('\n✅ 验证通过：容量快照已正确持久化并能在启动时恢复。');
        } else if (Object.keys(statsBefore).length === 0) {
            console.log('\n⚠️ 警告：没有统计到任何文件，请确保数据库中有文件记录。');
        } else {
            console.error('\n❌ 验证失败：重载后的数据与持久化前不一致。');
        }

    } catch (err) {
        console.error('\n❌ 测试过程出错:', err);
    } finally {
        process.exit(0);
    }
}

testQuotaPersistence();
