/**
 * CommerceSphere Notification Service — RabbitMQ Configuration
 *
 * Manages RabbitMQ connection, channel, exchange/queue setup for the
 * Notification Service. This service is a pure consumer — it never
 * publishes events, only listens and reacts.
 *
 * Topology:
 *   Exchange: order_events (topic) — consumes order.created, order.cancelled
 *   Exchange: inventory_events (topic) — consumes inventory.reserved, inventory.failed
 *
 *   Queue: notification.order_events — binds to order_events / order.created, order.cancelled
 *   Queue: notification.inventory_events — binds to inventory_events / inventory.reserved, inventory.failed
 *
 * Key interview point: Notification Service has its OWN queues bound to the
 * SAME exchanges that Inventory Service uses. This is the fan-out pattern with
 * topic exchanges — multiple consumers process the same event independently.
 * RabbitMQ delivers a copy of each message to every bound queue, not just one.
 */

const amqplib = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://commercesphere:changeme_rabbit@localhost:5672';

const EXCHANGES = {
    ORDER_EVENTS: 'order_events',
    INVENTORY_EVENTS: 'inventory_events',
};

const QUEUES = {
    ORDER_NOTIFICATIONS: 'notification.order_events',
    INVENTORY_NOTIFICATIONS: 'notification.inventory_events',
};

const ROUTING_KEYS = {
    ORDER_CREATED: 'order.created',
    ORDER_CANCELLED: 'order.cancelled',
    INVENTORY_RESERVED: 'inventory.reserved',
    INVENTORY_FAILED: 'inventory.failed',
};

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ with exponential backoff retry.
 */
async function connectRabbitMQ(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            connection = await amqplib.connect(RABBITMQ_URL);
            channel = await connection.createChannel();

            // Assert exchanges (idempotent — other services may have already created them)
            await channel.assertExchange(EXCHANGES.ORDER_EVENTS, 'topic', { durable: true });
            await channel.assertExchange(EXCHANGES.INVENTORY_EVENTS, 'topic', { durable: true });

            // Assert notification-specific queues
            await channel.assertQueue(QUEUES.ORDER_NOTIFICATIONS, { durable: true });
            await channel.assertQueue(QUEUES.INVENTORY_NOTIFICATIONS, { durable: true });

            // Bind order event queue
            await channel.bindQueue(
                QUEUES.ORDER_NOTIFICATIONS,
                EXCHANGES.ORDER_EVENTS,
                ROUTING_KEYS.ORDER_CREATED
            );
            await channel.bindQueue(
                QUEUES.ORDER_NOTIFICATIONS,
                EXCHANGES.ORDER_EVENTS,
                ROUTING_KEYS.ORDER_CANCELLED
            );

            // Bind inventory event queue
            await channel.bindQueue(
                QUEUES.INVENTORY_NOTIFICATIONS,
                EXCHANGES.INVENTORY_EVENTS,
                ROUTING_KEYS.INVENTORY_RESERVED
            );
            await channel.bindQueue(
                QUEUES.INVENTORY_NOTIFICATIONS,
                EXCHANGES.INVENTORY_EVENTS,
                ROUTING_KEYS.INVENTORY_FAILED
            );

            // Prefetch 1 — process one notification at a time
            await channel.prefetch(1);

            connection.on('error', (err) => {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    service: 'notification-service',
                    message: 'RabbitMQ connection error',
                    error: err.message,
                }));
            });

            connection.on('close', () => {
                console.warn(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'notification-service',
                    message: 'RabbitMQ connection closed',
                }));
                channel = null;
                connection = null;
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'notification-service',
                message: 'RabbitMQ connection established',
                exchanges: Object.values(EXCHANGES),
                queues: Object.values(QUEUES),
            }));

            return channel;
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'notification-service',
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
