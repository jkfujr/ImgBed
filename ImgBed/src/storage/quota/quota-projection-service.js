import { createLogger } from '../../utils/logger.js';

const log = createLogger('storage');

class QuotaProjectionService {
    constructor({ db, logger = log } = {}) {
        this.db = db;
        this.log = logger;
        this.quotaProjection = new Map();
        this.usageStats = new Map();
    }

    async loadQuotaFromCache() {
        const db = this.db;
        try {
            const cacheRecords = db.prepare(`
                SELECT storage_id, used_bytes
                FROM storage_quota_cache
            `).all();

            this.quotaProjection.clear();
            for (const record of cacheRecords) {
                this.quotaProjection.set(record.storage_id, Number(record.used_bytes) || 0);
            }

            if (cacheRecords.length > 0) {
                this.log.info({ count: cacheRecords.length }, 'loaded quota projection from cache');
            }
        } catch (err) {
            this.log.warn({ err }, 'failed to load quota projection from cache, falling back to history');
            await this.loadQuotaFromHistory();
        }
    }

    async loadQuotaFromHistory() {
        const db = this.db;
        try {
            const latestRecords = db.prepare(`
                SELECT h.storage_id, h.used_bytes
                FROM storage_quota_history h
                INNER JOIN (
                    SELECT storage_id, MAX(id) AS max_id
                    FROM storage_quota_history
                    GROUP BY storage_id
                ) latest ON latest.max_id = h.id
            `).all();

            this.quotaProjection.clear();
            for (const record of latestRecords) {
                this.quotaProjection.set(record.storage_id, Number(record.used_bytes) || 0);
            }

            if (latestRecords.length > 0) {
                this.log.info({ count: latestRecords.length }, 'loaded quota projection from history');
            }
        } catch (err) {
            this.log.error({ err }, 'failed to load quota projection from history');
        }
    }

    async getQuotaHistory(storageId, limit = 100) {
        const db = this.db;
        try {
            return db.prepare(
                'SELECT * FROM storage_quota_history WHERE storage_id = ? ORDER BY recorded_at DESC LIMIT ?'
            ).all(storageId, limit);
        } catch (err) {
            this.log.error({ err, storageId }, 'failed to get quota history');
            return [];
        }
    }

    async initUsageStats() {
        const db = this.db;
        try {
            const stats = db.prepare(`
                SELECT storage_instance_id, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL
                GROUP BY storage_instance_id
            `).all();

            this.usageStats.clear();
            for (const row of stats) {
                this.usageStats.set(row.storage_instance_id, {
                    uploadCount: 0,
                    fileCount: Number(row.file_count) || 0,
                });
            }
        } catch (err) {
            this.log.error({ err }, 'failed to initialize usage stats');
        }
    }

    getUsageStatsMap() {
        return this.usageStats;
    }

    getUsageStats() {
        const stats = {};
        this.usageStats.forEach((value, key) => {
            stats[key] = { ...value };
        });
        return stats;
    }

    async applyPendingQuotaEvents({ operationId = null, adjustUsageStats = true, recordSnapshots = true } = {}) {
        const db = this.db;
        try {
            const rows = operationId
                ? db.prepare(
                    'SELECT * FROM storage_quota_events WHERE applied_at IS NULL AND operation_id = ? ORDER BY id ASC'
                ).all(operationId)
                : db.prepare(
                    'SELECT * FROM storage_quota_events WHERE applied_at IS NULL ORDER BY id ASC'
                ).all();

            if (rows.length === 0) {
                return { applied: 0, storageIds: [] };
            }

            const nextProjection = new Map(this.quotaProjection);
            const nextUsageStats = new Map();
            for (const [storageId, stat] of this.usageStats.entries()) {
                nextUsageStats.set(storageId, { ...stat });
            }

            const affectedStorageIds = new Set();
            for (const row of rows) {
                const storageId = row.storage_id;
                const currentBytes = nextProjection.get(storageId) || 0;
                nextProjection.set(storageId, currentBytes + (Number(row.bytes_delta) || 0));
                affectedStorageIds.add(storageId);

                if (adjustUsageStats) {
                    const delta = Number(row.file_count_delta) || 0;
                    if (delta !== 0) {
                        const currentStat = nextUsageStats.get(storageId) || { uploadCount: 0, fileCount: 0 };
                        currentStat.fileCount = Math.max(0, currentStat.fileCount + delta);
                        if (row.event_type === 'upload' && delta > 0) {
                            currentStat.uploadCount += delta;
                        }
                        nextUsageStats.set(storageId, currentStat);
                    }
                }
            }

            const markAppliedStmt = db.prepare(
                'UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE id = ?'
            );
            const insertSnapshotStmt = db.prepare(
                'INSERT INTO storage_quota_history (storage_id, used_bytes) VALUES (?, ?)'
            );

            const persistProjection = db.transaction((events, storageIds) => {
                for (const event of events) {
                    markAppliedStmt.run(event.id);
                }

                if (recordSnapshots) {
                    for (const storageId of storageIds) {
                        insertSnapshotStmt.run(storageId, nextProjection.get(storageId) || 0);
                    }
                }
            });

            try {
                persistProjection(rows, [...affectedStorageIds]);
                this.quotaProjection = nextProjection;
                this.usageStats = nextUsageStats;
            } catch (projectionErr) {
                const eventIds = rows.map((row) => row.id);
                if (eventIds.length > 0) {
                    const placeholders = eventIds.map(() => '?').join(',');
                    db.prepare(`UPDATE storage_quota_events SET applied_at = NULL WHERE id IN (${placeholders})`)
                        .run(...eventIds);
                }
                this.log.error({ err: projectionErr }, 'failed to persist quota projection');
                throw projectionErr;
            }

            return { applied: rows.length, storageIds: [...affectedStorageIds] };
        } catch (err) {
            this.log.error({ err }, 'failed to apply pending quota events');
            throw err;
        }
    }

    async rebuildAllQuotaStats() {
        const db = this.db;
        try {
            const rows = db.prepare(`
                SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL AND status = 'active'
                GROUP BY storage_instance_id
            `).all();

            const nextProjection = new Map();
            const nextUsageStats = new Map();
            const historyRecords = [];
            const cacheRecords = [];

            for (const row of rows) {
                const storageId = row.storage_instance_id;
                const usedBytes = Number(row.used_bytes) || 0;
                const fileCount = Number(row.file_count) || 0;
                nextProjection.set(storageId, usedBytes);
                nextUsageStats.set(storageId, { uploadCount: 0, fileCount });
                historyRecords.push({ storage_id: storageId, used_bytes: usedBytes });
                cacheRecords.push({ storage_id: storageId, used_bytes: usedBytes, file_count: fileCount });
            }

            const rebuildProjection = db.transaction((records, cacheRecs) => {
                db.prepare(
                    'UPDATE storage_quota_events SET applied_at = CURRENT_TIMESTAMP WHERE applied_at IS NULL'
                ).run();

                if (records.length > 0) {
                    const insertHistoryStmt = db.prepare(
                        'INSERT INTO storage_quota_history (storage_id, used_bytes) VALUES (@storage_id, @used_bytes)'
                    );
                    for (const record of records) {
                        insertHistoryStmt.run(record);
                    }
                }

                if (cacheRecs.length > 0) {
                    const upsertCacheStmt = db.prepare(`
                        INSERT INTO storage_quota_cache (storage_id, used_bytes, file_count, last_updated)
                        VALUES (@storage_id, @used_bytes, @file_count, CURRENT_TIMESTAMP)
                        ON CONFLICT(storage_id) DO UPDATE SET
                            used_bytes = @used_bytes,
                            file_count = @file_count,
                            last_updated = CURRENT_TIMESTAMP
                    `);
                    for (const record of cacheRecs) {
                        upsertCacheStmt.run(record);
                    }
                }
            });

            rebuildProjection(historyRecords, cacheRecords);
            this.quotaProjection = nextProjection;
            this.usageStats = nextUsageStats;

            this.log.info({ count: historyRecords.length }, 'rebuilt quota projection');
        } catch (err) {
            this.log.error({ err }, 'failed to rebuild quota projection');
        }
    }

    async verifyQuotaConsistency() {
        const db = this.db;
        try {
            const actualStats = db.prepare(`
                SELECT storage_instance_id, SUM(size) AS used_bytes, COUNT(*) AS file_count
                FROM files
                WHERE storage_instance_id IS NOT NULL AND status = 'active'
                GROUP BY storage_instance_id
            `).all();

            const cachedStats = db.prepare(`
                SELECT storage_id, used_bytes, file_count
                FROM storage_quota_cache
            `).all();

            const actualMap = new Map(actualStats.map((stat) => [stat.storage_instance_id, stat]));
            const cachedMap = new Map(cachedStats.map((stat) => [stat.storage_id, stat]));
            const inconsistencies = [];

            for (const [storageId, cached] of cachedMap) {
                const actual = actualMap.get(storageId);
                if (!actual) {
                    inconsistencies.push({
                        storageId,
                        issue: 'cache_orphan',
                        cached: { used_bytes: cached.used_bytes, file_count: cached.file_count },
                        actual: { used_bytes: 0, file_count: 0 },
                    });
                } else if (
                    cached.used_bytes !== Number(actual.used_bytes)
                    || cached.file_count !== Number(actual.file_count)
                ) {
                    inconsistencies.push({
                        storageId,
                        issue: 'mismatch',
                        cached: { used_bytes: cached.used_bytes, file_count: cached.file_count },
                        actual: { used_bytes: Number(actual.used_bytes), file_count: Number(actual.file_count) },
                    });
                }
            }

            for (const [storageId, actual] of actualMap) {
                if (!cachedMap.has(storageId)) {
                    inconsistencies.push({
                        storageId,
                        issue: 'cache_missing',
                        cached: { used_bytes: 0, file_count: 0 },
                        actual: { used_bytes: Number(actual.used_bytes), file_count: Number(actual.file_count) },
                    });
                }
            }

            if (inconsistencies.length > 0) {
                this.log.warn({ inconsistencies }, 'quota projection consistency check failed');
                return { consistent: false, inconsistencies };
            }

            this.log.info('quota projection consistency check passed');
            return { consistent: true, inconsistencies: [] };
        } catch (err) {
            this.log.error({ err }, 'failed to verify quota projection consistency');
            throw err;
        }
    }

    getUsedBytes(storageId) {
        return this.quotaProjection.get(storageId) || 0;
    }

    getAllQuotaStats() {
        const stats = {};
        for (const [id, bytes] of this.quotaProjection.entries()) {
            stats[id] = bytes;
        }
        return stats;
    }
}

export { QuotaProjectionService };
