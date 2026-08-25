/**
 * CommerceSphere Catalog Service — Redis Configuration
 *
 * Creates and exports a single ioredis client instance for caching.
 * Uses the REDIS_URL environment variable for connection.
 *
 * Why ioredis over node-redis?
 *   - Built-in reconnection with exponential backoff
 *   - Better cluster/sentinel support (production readiness)
 *   - Lua scripting support (useful for atomic cache operations)
 *   - Slightly more ergonomic API
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
    // Retry strategy: exponential backoff, max 30s between retries
    retryStrategy(times) {
        const delay = Math.min(times * 500, 30000);
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'catalog-service',
            message: `Redis reconnect attempt #${times}, next in ${delay}ms`,
        }));
        return delay;
    },
    // Don't throw on connection errors — degrade gracefully
    // (cache misses are acceptable, hard failures are not)
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
});

redis.on('connect', () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'catalog-service',
        message: 'Redis connection established.',
    }));
});

redis.on('ready', () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'catalog-service',
        message: 'Redis client ready.',
    }));
});

redis.on('error', (err) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'catalog-service',
        message: 'Redis connection error',
        error: err.message,
    }));
});

module.exports = redis;
