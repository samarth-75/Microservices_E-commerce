/**
 * CommerceSphere — Cart Service Entry Point
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID (cross-service tracing)
 *   3. Security headers (Helmet) and CORS
 *   4. Cart CRUD: add, get, update quantity, remove, clear
 *   5. Guest cart with TTL (7 days) via x-guest-id header
 *   6. Authenticated user cart (30 days) via JWT
 *   7. Cart merge on login (guest → user)
 *   8. Cross-service product validation (REST → Catalog Service)
 *   9. Input validation (Joi) on all routes
 *
 * Database: Redis via ioredis (Redis IS the primary store, not a cache)
 * No MongoDB/PostgreSQL — carts are ephemeral, session-scoped data.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const redis = require('./config/redis');
const cartRoutes = require('./routes/cart.routes');

const app = express();
const PORT = process.env.PORT || 3003;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(helmet());
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);

// Request ID
app.use((req, _res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    next();
});

// Structured JSON logging
morgan.token('req-id', (req) => req.id);
app.use(
    morgan((tokens, req, res) =>
        JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'cart-service',
            method: tokens.method(req, res),
            url: tokens.url(req, res),
            status: Number(tokens.status(req, res)),
            responseTime: `${tokens['response-time'](req, res)}ms`,
            requestId: tokens['req-id'](req, res),
        })
    )
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Required by AGENTS.md. Returns uptime and Redis connectivity status.
 * Cart service depends ONLY on Redis — no other database to check.
 */
app.get('/health', async (_req, res) => {
    let redisStatus = 'ok';

    try {
        await redis.ping();
    } catch {
        redisStatus = 'error';
    }

    res.json({
        status: redisStatus === 'ok' ? 'ok' : 'degraded',
        service: 'cart-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            redis: redisStatus,
        },
    });
});

// Mount cart routes at /cart
// Gateway proxies /api/cart/* → /cart/*
app.use('/cart', cartRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Cart Service.',
    });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'cart-service',
        requestId: req.id,
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    }));

    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production'
            ? 'Something went wrong'
            : err.message,
    });
});

// ---------------------------------------------------------------------------
// Server start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'cart-service',
        message: `Cart Service listening on port ${PORT}`,
        environment: process.env.NODE_ENV || 'development',
    }));
});

module.exports = app;
