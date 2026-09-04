/**
 * CommerceSphere — Notification Service
 *
 * A pure consumer service. It has no REST API endpoints beyond /health.
 * It connects to RabbitMQ, starts consumers for order and inventory events,
 * and logs simulated email/SMS notifications.
 *
 * Per PRD.md: "the interesting part is the event pipeline, not the
 * third-party integration."
 *
 * Port: 3007
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { connectRabbitMQ, isConnected, closeRabbitMQ } = require('./config/rabbitmq');
const { startOrderEventsConsumer } = require('./consumers/orderEvents.consumer');
const { startInventoryEventsConsumer } = require('./consumers/inventoryEvents.consumer');

const app = express();
const PORT = process.env.PORT || 3007;

// ---------------------------------------------------------------------------
// Request ID middleware
// ---------------------------------------------------------------------------
app.use((req, _res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    next();
});

// ---------------------------------------------------------------------------
// Health endpoint — required by AGENTS.md for every service
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
    res.json({
        status: isConnected() ? 'ok' : 'degraded',
        service: 'notification-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dependencies: {
            rabbitmq: isConnected() ? 'ok' : 'disconnected',
        },
    });
});

// ---------------------------------------------------------------------------
// 404 catch-all (this service has no other routes)
// ---------------------------------------------------------------------------
app.use((_req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'Notification Service has no REST API. It is a consumer-only service.',
    });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
    try {
        // 1. Connect to RabbitMQ
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'notification-service',
            message: 'Connecting to RabbitMQ...',
        }));

        await connectRabbitMQ();

        // 2. Start consumers
        startOrderEventsConsumer();
        startInventoryEventsConsumer();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'notification-service',
            message: 'All consumers started successfully.',
        }));

        // 3. Start Express (for /health only)
        app.listen(PORT, () => {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'notification-service',
                message: `Notification Service listening on port ${PORT}`,
                environment: process.env.NODE_ENV || 'development',
            }));
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'notification-service',
            message: 'Failed to start Notification Service',
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
        service: 'notification-service',
        message: 'SIGTERM received — shutting down gracefully',
    }));
    await closeRabbitMQ();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await closeRabbitMQ();
    process.exit(0);
});

start();

module.exports = app;
