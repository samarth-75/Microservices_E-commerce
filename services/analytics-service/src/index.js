/**
 * CommerceSphere — Analytics Service
 *
 * Dual-purpose service:
 *   1. RabbitMQ consumer — records order events into analytics Postgres DB
 *   2. REST API (admin-only) — exposes aggregated metrics for dashboards
 *
 * Per Technical_Specification.md §2: "Sales metrics, dashboards"
 * Per PRD.md §3: "Basic sales analytics dashboard (orders per period, top products)"
 *
 * Port: 3008
 * Database: PostgreSQL (commercesphere_analytics)
 * Messaging: RabbitMQ (consumes order.created, order.cancelled)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { sequelize } = require('./models');
const { connectRabbitMQ, isConnected, closeRabbitMQ } = require('./config/rabbitmq');
const { startOrderEventsConsumer } = require('./consumers/orderEvents.consumer');
const analyticsRoutes = require('./routes/analytics.routes');

const app = express();
const PORT = process.env.PORT || 3008;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Request ID
app.use((req, _res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    next();
});

// Body parsing (needed for REST routes)
app.use(express.json());

// ---------------------------------------------------------------------------
// Health endpoint — required by AGENTS.md
// ---------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
    let dbStatus = 'ok';
    try {
        await sequelize.authenticate();
    } catch (err) {
        dbStatus = 'error';
    }

    const status = dbStatus === 'ok' && isConnected() ? 'ok' : 'degraded';

    res.json({
        status,
        service: 'analytics-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            postgres: dbStatus,
            rabbitmq: isConnected() ? 'ok' : 'disconnected',
        },
    });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/analytics', analyticsRoutes);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested route does not exist on the Analytics Service.',
    });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'analytics-service',
        message: err.message,
        stack: err.stack,
    }));
    res.status(500).json({
        error: 'Internal Server Error',
        message: 'Something went wrong.',
    });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
    try {
        // 1. Connect to PostgreSQL
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'Connecting to PostgreSQL...',
        }));

        await sequelize.authenticate();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'PostgreSQL connection established.',
        }));

        // 2. Sync models (dev mode — creates tables if they don't exist)
        await sequelize.sync({ alter: true });
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'Database models synchronized.',
        }));

        // 3. Connect to RabbitMQ
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'Connecting to RabbitMQ...',
        }));

        await connectRabbitMQ();

        // 4. Start consumers
        startOrderEventsConsumer();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'All consumers started successfully.',
        }));

        // 5. Start Express
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'analytics-service',
                message: `Analytics Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            message: 'Failed to start Analytics Service',
            error: err.message,
        }));
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'analytics-service',
        message: 'SIGTERM received — shutting down gracefully',
    }));
    await closeRabbitMQ();
    await sequelize.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await closeRabbitMQ();
    await sequelize.close();
    process.exit(0);
});

start();

module.exports = app;
