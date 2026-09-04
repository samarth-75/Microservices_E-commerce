/**
 * CommerceSphere Analytics Service — RabbitMQ Configuration
 *
 * Manages RabbitMQ connection for the Analytics Service.
 * This service consumes order events to build its own analytics data store.
 *
 * Topology:
 *   Exchange: order_events (topic) — consumes order.created, order.cancelled
 *
 *   Queue: analytics.order_events — binds to order_events / order.created, order.cancelled
 *
 * Key interview point: This is the THIRD consumer of order_events (after Inventory
 * and Notification). Each has its own queue bound to the same exchange. RabbitMQ
 * delivers a copy of each message to every bound queue — this is the fan-out
 * pattern with topic exchanges. Analytics failure never blocks order processing.
 */

const amqplib = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://commercesphere:changeme_rabbit@localhost:5672';

const EXCHANGES = {
    ORDER_EVENTS: 'order_events',
};

const QUEUES = {
    ANALYTICS_ORDER_EVENTS: 'analytics.order_events',
};

const ROUTING_KEYS = {
    ORDER_CREATED: 'order.created',
    ORDER_CANCELLED: 'order.cancelled',
};

let connection = null;
let channel = null;

async function connectRabbitMQ(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            connection = await amqplib.connect(RABBITMQ_URL);
            channel = await connection.createChannel();

            // Assert exchange (idempotent)
            await channel.assertExchange(EXCHANGES.ORDER_EVENTS, 'topic', { durable: true });

            // Assert analytics-specific queue
            await channel.assertQueue(QUEUES.ANALYTICS_ORDER_EVENTS, { durable: true });

            // Bind to order events
            await channel.bindQueue(
                QUEUES.ANALYTICS_ORDER_EVENTS,
                EXCHANGES.ORDER_EVENTS,
                ROUTING_KEYS.ORDER_CREATED
            );
            await channel.bindQueue(
                QUEUES.ANALYTICS_ORDER_EVENTS,
                EXCHANGES.ORDER_EVENTS,
                ROUTING_KEYS.ORDER_CANCELLED
            );

            await channel.prefetch(1);

            connection.on('error', (err) => {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    service: 'analytics-service',
                    message: 'RabbitMQ connection error',
                    error: err.message,
                }));
            });

            connection.on('close', () => {
                console.warn(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'analytics-service',
                    message: 'RabbitMQ connection closed',
                }));
                channel = null;
                connection = null;
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'analytics-service',
                message: 'RabbitMQ connection established',
                exchanges: Object.values(EXCHANGES),
                queues: Object.values(QUEUES),
            }));

            return channel;
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'analytics-service',
                message: `RabbitMQ connection attempt ${attempt}/${maxRetries} failed`,
                error: err.message,
            }));

            if (attempt === maxRetries) {
                throw new Error(`Failed to connect to RabbitMQ after ${maxRetries} attempts`);
            }

            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

function getChannel() {
    return channel;
}

function isConnected() {
    return connection !== null && channel !== null;
}

async function closeRabbitMQ() {
    try {
        if (channel) await channel.close();
        if (connection) await connection.close();
    } catch (err) {
        // Ignore close errors
    }
}

module.exports = {
    connectRabbitMQ,
    getChannel,
    isConnected,
    closeRabbitMQ,
    EXCHANGES,
    QUEUES,
    ROUTING_KEYS,
};
