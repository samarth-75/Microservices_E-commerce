/**
 * CommerceSphere Cart Service — Redis Configuration
 *
 * Creates and exports a single ioredis client instance.
 * For the cart service, Redis is the PRIMARY data store (not just a cache).
 * Cart data lives exclusively in Redis — there is no backing database.
 *
 * Interview distinction:
 *   - Catalog Service: Redis = cache, MongoDB = source of truth
 *   - Cart Service: Redis = source of truth (no backing DB)
 *   This is intentional — carts are ephemeral, session-scoped data with
 *   natural expiry. Persistence guarantees aren't needed.
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
    retryStrategy(times) {
        const delay = Math.min(times * 500, 30000);
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'cart-service',
            message: `Redis reconnect attempt #${times}, next in ${delay}ms`,
        }));
        return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
});

redis.on('connect', () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'cart-service',
        message: 'Redis connection established.',
    }));
});

redis.on('ready', () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'cart-service',
        message: 'Redis client ready.',
    }));
});

redis.on('error', (err) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'cart-service',
        message: 'Redis connection error',
        error: err.message,
    }));
});

module.exports = redis;
