/**
 * CommerceSphere Catalog Service — Cache-Aside Helper
 *
 * Implements the cache-aside (lazy-loading) pattern for Redis:
 *   1. Check Redis for cached data
 *   2. On miss → fetch from MongoDB → write to Redis with TTL → return
 *   3. On write (create/update/delete) → invalidate relevant cache keys
 *
 * TTLs (from Technical_Specification.md §5):
 *   - Product list:   300s  (5 min)
 *   - Product detail: 1800s (30 min)
 *   - Categories:     3600s (1 hr)
 *
 * Cache key convention:
 *   catalog:products:list:<queryHash>
 *   catalog:products:<id>
 *   catalog:categories:all
 *   catalog:categories:<id>
 *
 * Interview talking points:
 *   - Why cache-aside vs. write-through? Cache-aside is simpler and handles
 *     cache failures gracefully (just a slower DB hit). Write-through adds
 *     latency to every write for a guarantee we don't need here.
 *   - Cache stampede risk: if a popular key expires and 1000 requests hit
 *     simultaneously, all 1000 go to MongoDB. Mitigation: add a mutex/lock
 *     (e.g. Redlock) or use probabilistic early expiration. Not implemented
 *     here (low traffic), but documented for interview readiness.
 */

const crypto = require('crypto');
const redis = require('../config/redis');

// TTL constants (seconds)
const TTL = {
    PRODUCT_LIST: 300,     // 5 minutes
    PRODUCT_DETAIL: 1800,  // 30 minutes
    CATEGORIES: 3600,      // 1 hour
};

// Key prefixes
const KEYS = {
    PRODUCT_LIST: 'catalog:products:list:',
    PRODUCT_DETAIL: 'catalog:products:',
    CATEGORY_ALL: 'catalog:categories:all',
    CATEGORY_DETAIL: 'catalog:categories:',
};

/**
 * Generate a deterministic hash from query parameters for cache keying.
 * Same query params in any order → same hash → same cache key.
 */
function hashQuery(queryObj) {
    // Sort keys for deterministic ordering
    const sorted = Object.keys(queryObj)
        .sort()
        .reduce((acc, key) => {
            if (queryObj[key] !== undefined && queryObj[key] !== null) {
                acc[key] = queryObj[key];
            }
            return acc;
        }, {});
    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Get data from cache. Returns parsed JSON or null on miss/error.
 * Errors are swallowed — a cache failure should never crash the request.
 */
async function getFromCache(key) {
    try {
        const cached = await redis.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
        return null;
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'catalog-service',
            message: 'Cache read error (degrading gracefully)',
            key,
            error: err.message,
        }));
        return null;
    }
}

/**
 * Write data to cache with a TTL.
 * Errors are swallowed — failing to cache shouldn't break the response.
 */
async function setCache(key, data, ttlSeconds) {
    try {
        await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'catalog-service',
            message: 'Cache write error (non-critical)',
            key,
            error: err.message,
        }));
    }
}

/**
 * Delete specific cache keys.
 * Used on product/category create/update/delete to ensure stale data
 * isn't served. We don't wait for TTL expiry on user-initiated writes.
 */
async function invalidateCacheByKeys(...keys) {
    try {
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'catalog-service',
            message: 'Cache invalidation error',
            keys,
            error: err.message,
        }));
    }
}

/**
 * Invalidate all cache keys matching a prefix pattern.
 * Uses SCAN (non-blocking) instead of KEYS (blocks Redis on large datasets).
 *
 * Used to clear all product list caches when any product is modified,
 * because the list cache is keyed by query hash — we can't predict which
 * list queries included the modified product.
 */
async function invalidateCacheByPattern(pattern) {
    try {
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== '0');
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'catalog-service',
            message: 'Cache pattern invalidation error',
            pattern,
            error: err.message,
        }));
    }
}

module.exports = {
    TTL,
    KEYS,
    hashQuery,
    getFromCache,
    setCache,
    invalidateCacheByKeys,
    invalidateCacheByPattern,
};
