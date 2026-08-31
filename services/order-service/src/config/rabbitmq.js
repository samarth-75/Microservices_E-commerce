/**
 * CommerceSphere Order Service — RabbitMQ Configuration
 *
 * Manages RabbitMQ connection, channel, exchange/queue setup, and event
 * publishing. This is the project's first RabbitMQ integration.
 *
 * Topology:
 *   Exchange: order_events (topic) — Order Service publishes here
 *   Exchange: inventory_events (topic) — Inventory Service publishes here
 *
 *   Queue: order.inventory_response — Order Service consumes
 *     Binds to inventory_events with routing keys:
 *       - inventory.reserved
 *       - inventory.failed
 *
 * Why topic exchange?
 *   - Allows routing-key-based filtering (e.g. order.created, inventory.reserved)
 *   - More flexible than direct or fanout — new consumers can bind with wildcards
 *   - Easy to explain in interviews: "events are published with a routing key,
 *     consumers bind with patterns they care about"
 */

const amqplib = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://commercesphere:changeme_rabbit@localhost:5672';

// Exchange and queue names — used by both publisher and consumer setup
const EXCHANGES = {
    ORDER_EVENTS: 'order_events',
    INVENTORY_EVENTS: 'inventory_events',
};

const QUEUES = {
    INVENTORY_RESPONSE: 'order.inventory_response',
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
 * Connect to RabbitMQ with retry logic.
 * Retries up to maxRetries times with exponential backoff.
 */
async function connectRabbitMQ(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            connection = await amqplib.connect(RABBITMQ_URL);
            channel = await connection.createChannel();

            // Assert exchanges (idempotent — safe to call on every startup)
            await channel.assertExchange(EXCHANGES.ORDER_EVENTS, 'topic', { durable: true });
            await channel.assertExchange(EXCHANGES.INVENTORY_EVENTS, 'topic', { durable: true });

            // Assert the queue this service consumes from
            await channel.assertQueue(QUEUES.INVENTORY_RESPONSE, { durable: true });

            // Bind queue to inventory_events exchange for reservation responses
            await channel.bindQueue(
                QUEUES.INVENTORY_RESPONSE,
                EXCHANGES.INVENTORY_EVENTS,
                ROUTING_KEYS.INVENTORY_RESERVED
            );
            await channel.bindQueue(
                QUEUES.INVENTORY_RESPONSE,
                EXCHANGES.INVENTORY_EVENTS,
                ROUTING_KEYS.INVENTORY_FAILED
            );

            // Prefetch 1 — process one message at a time for reliable handling
            await channel.prefetch(1);

            // Handle connection errors gracefully
            connection.on('error', (err) => {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    service: 'order-service',
                    message: 'RabbitMQ connection error',
                    error: err.message,
                }));
            });

            connection.on('close', () => {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'order-service',
                    message: 'RabbitMQ connection closed',
                }));
                channel = null;
                connection = null;
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'order-service',
                message: 'RabbitMQ connection established',
                exchanges: Object.values(EXCHANGES),
                queues: Object.values(QUEUES),
            }));

            return channel;
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                message: `RabbitMQ connection attempt ${attempt}/${maxRetries} failed`,
                error: err.message,
            }));

            if (attempt === maxRetries) {
                throw new Error(`Failed to connect to RabbitMQ after ${maxRetries} attempts`);
            }

            // Exponential backoff: 1s, 2s, 4s, 8s, 16s
            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

/**
 * Publish an event to an exchange with a routing key.
 * The message is a JSON object that gets stringified.
 */
function publishEvent(exchange, routingKey, message) {
    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'order-service',
            message: 'Cannot publish — RabbitMQ channel not available',
            exchange,
            routingKey,
        }));
        return false;
    }

    const payload = Buffer.from(JSON.stringify(message));

    const published = channel.publish(exchange, routingKey, payload, {
        persistent: true, // survive broker restarts
        contentType: 'application/json',
        timestamp: Date.now(),
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'order-service',
        message: 'Event published',
        exchange,
        routingKey,
        orderId: message.orderId,
    }));

    return published;
}

/**
 * Get the current channel (for consumers to use).
 */
function getChannel() {
    return channel;
}

/**
 * Check if RabbitMQ connection is alive.
 */
function isConnected() {
    return connection !== null && channel !== null;
}

/**
 * Gracefully close the connection.
 */
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
    publishEvent,
    getChannel,
    isConnected,
    closeRabbitMQ,
    EXCHANGES,
    QUEUES,
    ROUTING_KEYS,
};
