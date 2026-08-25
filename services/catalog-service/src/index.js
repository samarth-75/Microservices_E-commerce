/**
 * CommerceSphere — Catalog Service Entry Point
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID (cross-service tracing)
 *   3. Security headers (Helmet) and CORS
 *   4. Product CRUD: create, read (list/detail), update, soft-delete
 *   5. Category CRUD: create, read (list/detail), update, soft-delete
 *   6. Redis cache-aside for product lists, product details, categories
 *   7. Image upload to local disk (dev stand-in for CDN/S3)
 *   8. Pagination, filtering, sorting, full-text search
 *   9. JWT authentication + RBAC for admin routes
 *  10. Input validation (Joi) on all routes
 *
 * Database: MongoDB via Mongoose (document store for flexible product attributes)
 * Cache: Redis via ioredis (cache-aside pattern)
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { connectMongo, mongoose } = require('./config/database');
const redis = require('./config/redis');
const productRoutes = require('./routes/product.routes');
const categoryRoutes = require('./routes/category.routes');

const app = express();
const PORT = process.env.PORT || 3002;
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// ---------------------------------------------------------------------------
// Ensure uploads directory exists (for local dev image storage)
// ---------------------------------------------------------------------------
const uploadsPath = path.join(__dirname, '..', UPLOAD_DIR, 'products');
fs.mkdirSync(uploadsPath, { recursive: true });

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Security headers
app.use(helmet());

// CORS — allow all origins in dev; lock down per-environment later
app.use(cors());

// Parse JSON bodies
app.use(express.json());
// Parse URL-encoded bodies (for multipart form fallback)
app.use(express.urlencoded({ extended: true }));

// Trust proxy — needed for correct IP detection behind Docker networking
app.set('trust proxy', 1);

// Request ID — attach a unique ID to every incoming request
app.use((req, _res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    next();
});

// Structured JSON logging via Morgan custom format
morgan.token('req-id', (req) => req.id);
app.use(
    morgan((tokens, req, res) =>
        JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'catalog-service',
            method: tokens.method(req, res),
            url: tokens.url(req, res),
            status: Number(tokens.status(req, res)),
            responseTime: `${tokens['response-time'](req, res)}ms`,
            requestId: tokens['req-id'](req, res),
        })
    )
);

// ---------------------------------------------------------------------------
// Static files — serve uploaded images
// ---------------------------------------------------------------------------
app.use('/uploads', express.static(path.join(__dirname, '..', UPLOAD_DIR)));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Required by AGENTS.md for every service. Returns uptime, timestamp,
 * and dependency connectivity status (MongoDB + Redis).
 */
app.get('/health', async (_req, res) => {
    let mongoStatus = 'ok';
    let redisStatus = 'ok';

    try {
        // Check MongoDB: readyState 1 = connected
        if (mongoose.connection.readyState !== 1) {
            mongoStatus = 'error';
        }
    } catch {
        mongoStatus = 'error';
    }

    try {
        await redis.ping();
    } catch {
        redisStatus = 'error';
    }

    const overallStatus = (mongoStatus === 'ok' && redisStatus === 'ok')
        ? 'ok'
        : 'degraded';

    res.json({
        status: overallStatus,
        service: 'catalog-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            mongodb: mongoStatus,
            redis: redisStatus,
        },
    });
});

// Mount product routes at /catalog/products
// Gateway proxies /api/catalog/* → /catalog/*
app.use('/catalog/products', productRoutes);

// Mount category routes at /catalog/categories
app.use('/catalog/categories', categoryRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Catalog Service.',
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
        service: 'catalog-service',
        requestId: req.id,
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    }));

    // Handle Mongoose validation errors
    if (err.name === 'ValidationError') {
        const details = Object.values(err.errors).map((e) => ({
            field: e.path,
            message: e.message,
        }));
        return res.status(400).json({
            error: 'Validation Error',
            message: 'One or more fields failed validation.',
            details,
        });
    }

    // Handle Mongoose cast errors (invalid ObjectId, etc.)
    if (err.name === 'CastError') {
        return res.status(400).json({
            error: 'Validation Error',
            message: `Invalid ${err.kind}: ${err.value}`,
        });
    }

    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production'
            ? 'Something went wrong'
            : err.message,
    });
});

// ---------------------------------------------------------------------------
// Database connection & server start
// ---------------------------------------------------------------------------
async function start() {
    try {
        // Connect to MongoDB
        await connectMongo();

        // Start server
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: `Catalog Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'fatal',
            service: 'catalog-service',
            message: 'Failed to start Catalog Service',
            error: err.message,
            stack: err.stack,
        }));
        process.exit(1);
    }
}

start();

module.exports = app; // exported for testing
