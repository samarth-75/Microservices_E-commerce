/**
 * CommerceSphere — Payment Service Entry Point
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID
 *   3. Security headers (Helmet) and CORS
 *   4. Payment routes: create-session, webhook, get, refund
 *   5. JWT authentication and RBAC
 *   6. Joi input validation on all routes
 *   7. Stripe Checkout Sessions integration (sandbox/test mode)
 *   8. Webhook signature verification with raw body
 *
 * Database: PostgreSQL via Sequelize (database-per-service pattern)
 * External: Stripe API (sandbox mode)
 *
 * CRITICAL DESIGN NOTE — Body Parsing:
 *   Stripe webhook verification requires the raw request body (Buffer),
 *   NOT parsed JSON. If we use express.json() globally, the webhook handler
 *   gets a parsed object and signature verification fails. Solution:
 *   - Mount express.raw() on /payments/webhook BEFORE express.json()
 *   - Mount express.json() on all other routes
 *   This is the standard pattern recommended by Stripe's documentation.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('./models');
const paymentRoutes = require('./routes/payment.routes');

const app = express();
const PORT = process.env.PORT || 3006;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(helmet());
app.use(cors());
app.set('trust proxy', 1);

// Request ID — assigned before any route handler
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
            service: 'payment-service',
            method: tokens.method(req, res),
            url: tokens.url(req, res),
            status: Number(tokens.status(req, res)),
            responseTime: `${tokens['response-time'](req, res)}ms`,
            requestId: tokens['req-id'](req, res),
        })
    )
);

// ---------------------------------------------------------------------------
// Body parsing — CRITICAL ORDER
// ---------------------------------------------------------------------------
// The webhook route MUST receive the raw body (Buffer) for Stripe signature
// verification. express.json() would parse it into an object, breaking the
// signature check. We solve this by:
//   1. Mounting express.raw() on the webhook path
//   2. Mounting express.json() on everything else
// ---------------------------------------------------------------------------

// Webhook route gets raw body (Buffer)
app.use('/payments/webhook', express.raw({ type: 'application/json' }));

// All other routes get parsed JSON
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Returns uptime, timestamp, and dependency status for PostgreSQL.
 * Stripe is an external dependency — we don't health-check it (they have
 * their own status page at https://status.stripe.com).
 */
app.get('/health', async (_req, res) => {
    let dbStatus = 'ok';
    try {
        await sequelize.authenticate();
    } catch (err) {
        dbStatus = 'error';
    }

    const stripeConfigured = !!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_replace_me_with_real_key';

    res.json({
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        service: 'payment-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            postgres: dbStatus,
            stripe: stripeConfigured ? 'configured' : 'not_configured',
        },
    });
});

// Mount payment routes at /payments
// (gateway proxies /api/payments/* → /payments/*)
app.use('/payments', paymentRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Payment Service.',
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
        service: 'payment-service',
        requestId: req.id,
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    }));

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
        // 1. Authenticate DB connection
        await sequelize.authenticate();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'payment-service',
            message: 'PostgreSQL connection established successfully.',
        }));

        // 2. Sync models
        await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'payment-service',
            message: 'Database models synchronized.',
        }));

        // 3. Validate Stripe configuration
        if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_replace_me_with_real_key') {
            console.warn(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                service: 'payment-service',
                message: 'STRIPE_SECRET_KEY not configured — payment creation will fail. Set it in .env.',
            }));
        }

        if (!process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET === 'whsec_XXXXXXXXXXXXXXXXXXXXXXXX') {
            console.warn(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                service: 'payment-service',
                message: 'STRIPE_WEBHOOK_SECRET not configured — webhook verification will fail. Set it in .env.',
            }));
        }

        // 4. Start server
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'payment-service',
                message: `Payment Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'fatal',
            service: 'payment-service',
            message: 'Failed to start Payment Service',
            error: err.message,
            stack: err.stack,
        }));
        process.exit(1);
    }
}

start();

module.exports = app;
