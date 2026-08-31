/**
 * CommerceSphere — Inventory Service Entry Point
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID (cross-service tracing)
 *   3. Security headers (Helmet) and CORS
 *   4. Inventory routes: create, list, get, update stock
 *   5. JWT authentication and RBAC (admin-only)
 *   6. Input validation (Joi) on all routes
 *   7. RabbitMQ consumers: order.created → reserve, order.cancelled → release
 *
 * Database: PostgreSQL via Sequelize (database-per-service pattern)
 * Messaging: RabbitMQ (consume order events, publish inventory events)
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('./models');
const { connectRabbitMQ, isConnected } = require('./config/rabbitmq');
const { startOrderCreatedConsumer } = require('./consumers/orderCreated.consumer');
const { startOrderCancelledConsumer } = require('./consumers/orderCancelled.consumer');
const inventoryRoutes = require('./routes/inventory.routes');

const app = express();
const PORT = process.env.PORT || 3005;

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
            service: 'inventory-service',
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
 * Returns uptime, timestamp, and dependency status for PostgreSQL and RabbitMQ.
 */
app.get('/health', async (_req, res) => {
    let dbStatus = 'ok';
    try {
        await sequelize.authenticate();
    } catch (err) {
        dbStatus = 'error';
    }

    const rabbitStatus = isConnected() ? 'ok' : 'error';

    const overallStatus = dbStatus === 'ok' && rabbitStatus === 'ok' ? 'ok' : 'degraded';

    res.json({
        status: overallStatus,
        service: 'inventory-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            postgres: dbStatus,
            rabbitmq: rabbitStatus,
        },
    });
});

// Mount inventory routes at /inventory
// (gateway will proxy /api/inventory/* → /inventory/*)
app.use('/inventory', inventoryRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Inventory Service.',
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
        service: 'inventory-service',
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
// Database sync, RabbitMQ connect, consumer start & server start
// ---------------------------------------------------------------------------
async function start() {
    try {
        // 1. Authenticate DB connection
        await sequelize.authenticate();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'inventory-service',
            message: 'PostgreSQL connection established successfully.',
        }));

        // 2. Sync models
        await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'inventory-service',
            message: 'Database models synchronized.',
        }));

        // 3. Connect to RabbitMQ
        await connectRabbitMQ();

        // 4. Start consumers
        startOrderCreatedConsumer();
        startOrderCancelledConsumer();

        // 5. Start server
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'inventory-service',
                message: `Inventory Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'fatal',
            service: 'inventory-service',
            message: 'Failed to start Inventory Service',
            error: err.message,
            stack: err.stack,
        }));
        process.exit(1);
    }
}

start();

module.exports = app;
