import fs from 'fs';
import path from 'path';
import { sqlite } from '../database/index.js';

/**
 * 格式化 ISO 日期
 */
function formatDate(timestamp) {
    if (!timestamp) return new Date().toISOString().replace('T', ' ').substring(0, 19);
    return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 转换旧版的 Channel 定义为新的标准类型
 */
function mapChannelType(oldChannel) {
    if (!oldChannel) return 'local';
    const c = oldChannel.toLowerCase();
    if (c.includes('telegram')) return 'telegram';
    if (c.includes('discord')) return 'discord';
    if (c.includes('huggingface')) return 'huggingface';
    if (c.includes('s3') || c.includes('r2')) return 's3';
    if (c.includes('onedrive')) return 'external'; // OneDrive等大多被外部或直链所取代，统一视作无法读取的外部
    return 'local';
}

/**
 * 执行迁移主函数
 */
async function runMigration() {
    const backupFilePath = process.argv[2];
    if (!backupFilePath) {
        console.error('请提供要导入的 JSON 备份文件路径！');
        console.error('用法: node src/scripts/migrate.js /path/to/backup.json');
        process.exit(1);
    }

    const fullPath = path.resolve(process.cwd(), backupFilePath);
    if (!fs.existsSync(fullPath)) {
        console.error(`未找到文件: ${fullPath}`);
        process.exit(1);
    }

    console.log(`[Migrate] 正在读取备份数据: ${fullPath}...`);
    const fileData = fs.readFileSync(fullPath, 'utf-8');
    const backup = JSON.parse(fileData);

    const oldFiles = backup.data?.files || {};
    const fileKeys = Object.keys(oldFiles);
    console.log(`[Migrate] 发现 ${fileKeys.length} 份文件记录，准备开始解析...`);

    // ============================================
    // 第一步：重建目录树关系表
    // ============================================
    console.log(`[Migrate] 正在收集原始目录树...`);
    const allRawPaths = new Set();
    
    fileKeys.forEach(key => {
        const meta = oldFiles[key].metadata;
        if (meta && meta.Directory && meta.Directory !== 'None') {
            // "QQ/" -> "/QQ"
            let dirPath = meta.Directory.startsWith('/') ? meta.Directory : `/${meta.Directory}`;
            if (dirPath.endsWith('/')) dirPath = dirPath.slice(0, -1);
            if (dirPath === '') dirPath = '/';
            allRawPaths.add(dirPath);
        }
    });

    const dirArray = Array.from(allRawPaths).filter(d => d !== '/').sort(); // 确保从短到长生成父级
    const dirIdMap = { '/': null };

    for (const dirPath of dirArray) {
        // 判断它在库里存在吗
        let existing = sqlite.prepare('SELECT id FROM directories WHERE path = ?').get(dirPath);
        if (!existing) {
            const parts = dirPath.split('/');
            const name = parts[parts.length - 1];

            // 找出父级
            const parentPath = parts.slice(0, -1).join('/') || '/';
            const parentId = dirIdMap[parentPath] || null;

            const res = sqlite.prepare(
                'INSERT INTO directories (name, path, parent_id) VALUES (?, ?, ?)'
            ).run(name, dirPath, parentId);
            existing = { id: Number(res.lastInsertRowid) };
        }
        dirIdMap[dirPath] = existing.id;
    }
    console.log(`[Migrate] 已同步 ${dirArray.length} 个规范目录。`);

    // ============================================
    // 第二步：洗炼内联表单并构建记录
    // ============================================
    const recordsToInsert = [];
    
    for (const key of fileKeys) {
        const meta = oldFiles[key].metadata;
        if (!meta) continue;

        // 生成新短 ID。用纳秒防重或者利用老 key的简写。
        // 为了URL不冲突，使用原本文件名的核心部分或干脆通过其原本 Hash 作 id。
        // 旧的 "QQ/..." 通常带有一串长hash，我们可以抽取它作为旧ID。
        let oldHash = meta.FileName.split('.')[0];
        if (oldHash.length > 50) {
            // 是个完整长 hash (64位)
            oldHash = oldHash.substring(0, 16); 
        }

        const id = `${oldHash}_r${Math.random().toString(36).substring(2, 6)}`;

        // 整理目录名称
        let dirPath = meta.Directory ? meta.Directory : '/';
        dirPath = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
        if (dirPath !== '/' && dirPath.endsWith('/')) dirPath = dirPath.slice(0, -1);

        const channelType = mapChannelType(meta.Channel);
        
        // 核心：抽取旧存储 Key 与兼容旧 Token
        let storageKey = meta.FileName || id;
        let storageConfig = {};
        let t_file_id = null, t_chat_id = null, t_bot_token = null;
        let d_message_id = null, d_channel_id = null;
        let s_s3_loc = null;
        
        if (channelType === 'telegram') {
            t_file_id = meta.TgFileId;
            t_chat_id = meta.TgChatId;
            t_bot_token = meta.TgBotToken;
            storageKey = t_file_id || storageKey;
        } else if (channelType === 'discord') {
            d_message_id = meta.DiscordMessageId;
            d_channel_id = meta.DiscordChannelId;
            storageKey = `${d_channel_id}/${d_message_id}`; // 以斜线结合以便我们 new DiscordStorage 的读取支持
        } else if (channelType === 's3') {
            storageKey = meta.S3FileKey || meta.FileName;
            storageConfig.legacy_s3 = {
                accessKeyId: meta.S3AccessKeyId,
                secretAccessKey: meta.S3SecretAccessKey,
                endpoint: meta.S3Endpoint,
                bucket: meta.S3BucketName,
                region: meta.S3Region,
                pathStyle: meta.S3PathStyle
            };
            s_s3_loc = meta.S3Location;
        } else if (channelType === 'huggingface') {
             // ...
             storageKey = meta.HuggingFacePath || meta.FileName;
        }

        // 把原始旧信息作为完整备份挤到 storage_config 中以防遗落任何线索
        storageConfig.original_meta = meta;

        recordsToInsert.push({
            id: id,
            file_name: meta.FileName,
            original_name: meta.FileName,
            mime_type: meta.FileType || 'application/octet-stream',
            size: meta.FileSizeBytes ? Number(meta.FileSizeBytes) : 0,
            
            storage_channel: channelType,
            storage_key: storageKey,
            storage_config: JSON.stringify(storageConfig),
            
            upload_ip: meta.UploadIP || 'unknown',
            created_at: formatDate(meta.TimeStamp),
            updated_at: formatDate(meta.TimeStamp),
            
            directory: dirPath,
            tags: Array.isArray(meta.Tags) ? JSON.stringify(meta.Tags) : null,
            is_public: 1, // 旧的全部视作公共
            
            telegram_file_id: t_file_id,
            telegram_chat_id: t_chat_id,
            telegram_bot_token: t_bot_token,
            discord_message_id: d_message_id,
            discord_channel_id: d_channel_id
        });
    }

    // ============================================
    // 第三步：批量高速持久化写入数据库
    // ============================================
    console.log(`[Migrate] 开始并发表批插文件，共计 ${recordsToInsert.length} 份数据...`);
    const BATCH_SIZE = 100;
    const insertStmt = sqlite.prepare(`INSERT INTO files (
        id, file_name, original_name, mime_type, size,
        storage_channel, storage_key, storage_config,
        upload_ip, created_at, updated_at,
        directory, tags, is_public,
        telegram_file_id, telegram_chat_id, telegram_bot_token,
        discord_message_id, discord_channel_id
    ) VALUES (
        @id, @file_name, @original_name, @mime_type, @size,
        @storage_channel, @storage_key, @storage_config,
        @upload_ip, @created_at, @updated_at,
        @directory, @tags, @is_public,
        @telegram_file_id, @telegram_chat_id, @telegram_bot_token,
        @discord_message_id, @discord_channel_id
    )`);

    const insertBatch = sqlite.transaction((batch) => {
        for (const rec of batch) insertStmt.run(rec);
    });

    for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
        const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
        insertBatch(batch);
        console.log(`[Migrate] 已推入 ${i + batch.length} 条...`);
    }

    console.log(`[Migrate] 🎉 数据迁移完全完成！所有的旧图数据已经接驳进全新的数据库架构中！`);
    process.exit(0);
}

runMigration().catch(err => {
    console.error(`[Migrate] 致命错误：`, err);
    process.exit(1);
});
