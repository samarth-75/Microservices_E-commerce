/**
 * CommerceSphere Inventory Service — RabbitMQ Configuration
 *
 * Manages RabbitMQ connection, channel, exchange/queue setup, and event
 * publishing for the Inventory Service.
 *
 * Topology:
 *   Exchange: order_events (topic) — consumes order.created, order.cancelled
 *   Exchange: inventory_events (topic) — publishes inventory.reserved, inventory.failed
 *
 *   Queue: inventory.order_created — binds to order_events / order.created
 *   Queue: inventory.order_cancelled — binds to order_events / order.cancelled
 */

const amqplib = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://commercesphere:changeme_rabbit@localhost:5672';

const EXCHANGES = {
    ORDER_EVENTS: 'order_events',
    INVENTORY_EVENTS: 'inventory_events',
};

const QUEUES = {
    ORDER_CREATED: 'inventory.order_created',
    ORDER_CANCELLED: 'inventory.order_cancelled',
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
 */
async function connectRabbitMQ(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            connection = await amqplib.connect(RABBITMQ_URL);
            channel = await connection.createChannel();

            // Assert exchanges (idempotent)
            await channel.assertExchange(EXCHANGES.ORDER_EVENTS, 'topic', { durable: true });
            await channel.assertExchange(EXCHANGES.INVENTORY_EVENTS, 'topic', { durable: true });

            // Assert queues this service consumes from
            await channel.assertQueue(QUEUES.ORDER_CREATED, { durable: true });
            await channel.assertQueue(QUEUES.ORDER_CANCELLED, { durable: true });

            // Bind queues to order_events exchange
            await channel.bindQueue(
                QUEUES.ORDER_CREATED,
                EXCHANGES.ORDER_EVENTS,
                ROUTING_KEYS.ORDER_CREATED
            );
            await channel.bindQueue(
                QUEUES.ORDER_CANCELLED,
                EXCHANGES.ORDER_EVENTS,
                ROUTING_KEYS.ORDER_CANCELLED
            );

            // Prefetch 1 — process one message at a time for reliable stock operations
            await channel.prefetch(1);

            connection.on('error', (err) => {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    service: 'inventory-service',
                    message: 'RabbitMQ connection error',
                    error: err.message,
                }));
            });

            connection.on('close', () => {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'inventory-service',
                    message: 'RabbitMQ connection closed',
                }));
                channel = null;
                connection = null;
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'inventory-service',
                message: 'RabbitMQ connection established',
                exchanges: Object.values(EXCHANGES),
                queues: Object.values(QUEUES),
            }));

            return channel;
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
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

/**
 * Publish an event to an exchange with a routing key.
 */
function publishEvent(exchange, routingKey, message) {
    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'inventory-service',
            message: 'Cannot publish — RabbitMQ channel not available',
            exchange,
            routingKey,
        }));
        return false;
    }

    const payload = Buffer.from(JSON.stringify(message));

    const published = channel.publish(exchange, routingKey, payload, {
        persistent: true,
        contentType: 'application/json',
        timestamp: Date.now(),
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'inventory-service',
        message: 'Event published',
        exchange,
        routingKey,
        orderId: message.orderId,
    }));

    return published;
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
    publishEvent,
    getChannel,
    isConnected,
    closeRabbitMQ,
    EXCHANGES,
    QUEUES,
    ROUTING_KEYS,
};
