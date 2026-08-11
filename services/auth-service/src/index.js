/**
 * CommerceSphere — Auth Service Entry Point
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID (cross-service tracing)
 *   3. Security headers (Helmet) and CORS
 *   4. Auth routes: signup, login, refresh, logout, /me
 *   5. Rate limiting on auth endpoints
 *   6. Input validation (Joi) on all routes
 *   7. JWT access + refresh token rotation
 *   8. RBAC (Admin / Customer)
 *   9. bcrypt password hashing
 *
 * Database: PostgreSQL via Sequelize (database-per-service pattern)
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('./models');
const authRoutes = require('./routes/auth.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Security headers — Helmet sets sensible defaults (X-Content-Type-Options,
// X-Frame-Options, Strict-Transport-Security, etc.)
app.use(helmet());

// CORS — allow all origins in dev; will be locked down per-environment later
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Trust proxy — needed for rate limiter to correctly identify IPs behind
// Docker's internal networking / reverse proxy
app.set('trust proxy', 1);

// Request ID — attach a unique ID to every incoming request so logs from
// different services can be correlated for the same user action.
app.use((req, _res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    next();
});

// Structured JSON logging via Morgan custom format.
// Each log line is valid JSON with timestamp, method, url, status, response
// time, and the request ID for cross-service tracing.
morgan.token('req-id', (req) => req.id);
app.use(
    morgan((tokens, req, res) =>
        JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'auth-service',
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
 * Required by AGENTS.md for every service. Returns uptime, timestamp,
 * and database connectivity status so Docker healthchecks and monitoring
 * can verify the process AND its dependencies are alive.
 */
app.get('/health', async (_req, res) => {
    let dbStatus = 'ok';
    try {
        await sequelize.authenticate();
    } catch (err) {
        dbStatus = 'error';
    }

    res.json({
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        service: 'auth-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            postgres: dbStatus,
        },
    });
});

// Mount auth routes at /auth (gateway will proxy /api/auth/* → /auth/*)
app.use('/auth', authRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Auth Service.',
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
        service: 'auth-service',
        requestId: req.id,
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    }));

    // Handle Sequelize validation errors gracefully
    if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({
            error: 'Validation Error',
            message: err.errors?.map((e) => e.message).join(', ') || err.message,
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
// Database sync & server start
// ---------------------------------------------------------------------------
async function start() {
    try {
        // Authenticate DB connection
        await sequelize.authenticate();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'auth-service',
            message: 'PostgreSQL connection established successfully.',
        }));

        // Sync models — creates tables if they don't exist.
        // In production, use migrations (sequelize-cli) instead of sync.
        await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'auth-service',
            message: 'Database models synchronized.',
        }));

        // Start server
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'auth-service',
                message: `Auth Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'fatal',
            service: 'auth-service',
            message: 'Failed to start Auth Service',
            error: err.message,
            stack: err.stack,
        }));
        process.exit(1);
    }
}

start();

module.exports = app; // exported for testing
