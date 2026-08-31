/**
 * CommerceSphere — Order Service Entry Point
 *
 * Responsibilities:
 *   1. /health endpoint (required by AGENTS.md for every service)
 *   2. Structured JSON logging with request ID (cross-service tracing)
 *   3. Security headers (Helmet) and CORS
 *   4. Order routes: create, list, get, update status, cancel
 *   5. JWT authentication and RBAC
 *   6. Input validation (Joi) on all routes
 *   7. RabbitMQ: publish ORDER_CREATED, consume inventory responses
 *   8. Cross-service REST: cart-service, catalog-service
 *
 * Database: PostgreSQL via Sequelize (database-per-service pattern)
 * Messaging: RabbitMQ (topic exchange for order events)
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('./models');
const { connectRabbitMQ, isConnected } = require('./config/rabbitmq');
const { startInventoryResponseConsumer } = require('./consumers/inventoryResponse.consumer');
const orderRoutes = require('./routes/order.routes');

const app = express();
const PORT = process.env.PORT || 3004;

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
            service: 'order-service',
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
        service: 'order-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            postgres: dbStatus,
            rabbitmq: rabbitStatus,
        },
    });
});

// Mount order routes at /orders (gateway will proxy /api/orders/* → /orders/*)
app.use('/orders', orderRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Order Service.',
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
        service: 'order-service',
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
            service: 'order-service',
            message: 'PostgreSQL connection established successfully.',
        }));

        // 2. Sync models
        await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'order-service',
            message: 'Database models synchronized.',
        }));

        // 3. Connect to RabbitMQ
        await connectRabbitMQ();

        // 4. Start consumers
        startInventoryResponseConsumer();

        // 5. Start server
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'order-service',
                message: `Order Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'fatal',
            service: 'order-service',
            message: 'Failed to start Order Service',
            error: err.message,
            stack: err.stack,
        }));
        process.exit(1);
    }
}

start();

module.exports = app;
