/**
 * CommerceSphere Analytics Service — Order Events Consumer
 *
 * Consumes order.created and order.cancelled events and persists them
 * into the analytics database. This creates a denormalized read model
 * optimized for analytics queries (CQRS-lite pattern).
 *
 * Idempotency: OrderEvent has a unique constraint on orderId. If the same
 * event arrives twice (RabbitMQ redelivery), the INSERT fails gracefully
 * and the message is still acknowledged.
 */

const { getChannel, QUEUES } = require('../config/rabbitmq');
const { OrderEvent, OrderItemEvent } = require('../models');

function startOrderEventsConsumer() {
    const channel = getChannel();

    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            message: 'Cannot start order events consumer — channel not available',
        }));
        return;
    }

    channel.consume(QUEUES.ANALYTICS_ORDER_EVENTS, async (msg) => {
        if (!msg) return;

        try {
            const event = JSON.parse(msg.content.toString());
            const routingKey = msg.fields.routingKey;

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'analytics-service',
                message: 'Received order event',
                routingKey,
                orderId: event.orderId,
            }));

            switch (routingKey) {
                case 'order.created':
                    await handleOrderCreated(event);
                    break;

                case 'order.cancelled':
                    await handleOrderCancelled(event);
                    break;

                default:
                    console.warn(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        level: 'warn',
                        service: 'analytics-service',
                        message: `Unknown routing key: ${routingKey}`,
                    }));
            }

            channel.ack(msg);
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'analytics-service',
                message: 'Failed to process order event',
                error: err.message,
            }));

            // Requeue on failure
            channel.nack(msg, false, true);
        }
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'analytics-service',
        message: `Order events consumer started on queue: ${QUEUES.ANALYTICS_ORDER_EVENTS}`,
    }));
}

/**
 * Handle order.created — store order + items in analytics DB.
 */
async function handleOrderCreated(event) {
    const { orderId, userId, items, totalAmount } = event;

    try {
        // Idempotency: if orderId already exists, skip
        const existing = await OrderEvent.findOne({ where: { orderId } });
        if (existing) {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'analytics-service',
                message: 'Order event already recorded (idempotent skip)',
                orderId,
            }));
            return;
        }

        // Create the order event record
        await OrderEvent.create({
            orderId,
            userId,
            totalAmount: totalAmount || 0,
            itemCount: items ? items.length : 0,
            status: 'CREATED',
            orderDate: new Date(),
        });

        // Create item records for top-products queries
        if (items && items.length > 0) {
            const itemRecords = items.map((item) => ({
                orderId,
                productId: item.productId,
                productName: item.name || item.productName || 'Unknown Product',
                quantity: item.quantity || 1,
                price: item.price || 0,
            }));

            await OrderItemEvent.bulkCreate(itemRecords);
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'Order event recorded in analytics DB',
            orderId,
            itemCount: items ? items.length : 0,
            totalAmount,
        }));
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            message: 'Failed to record order event',
            orderId,
            error: err.message,
        }));
        throw err; // Rethrow so the consumer nacks
    }
}

/**
 * Handle order.cancelled — update the analytics record.
 */
async function handleOrderCancelled(event) {
    const { orderId } = event;

    try {
        const orderEvent = await OrderEvent.findOne({ where: { orderId } });

        if (!orderEvent) {
            // Order event might not exist yet if events arrive out of order
            console.warn(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                service: 'analytics-service',
                message: 'Received cancellation for unknown order — creating as cancelled',
                orderId,
            }));

            await OrderEvent.create({
                orderId,
                userId: event.userId || '00000000-0000-0000-0000-000000000000',
                totalAmount: event.totalAmount || 0,
                itemCount: 0,
                status: 'CANCELLED',
                orderDate: new Date(),
            });
            return;
        }

        await orderEvent.update({ status: 'CANCELLED' });

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'analytics-service',
            message: 'Order marked as cancelled in analytics DB',
            orderId,
        }));
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            message: 'Failed to process cancellation',
            orderId,
            error: err.message,
        }));
        throw err;
    }
}

module.exports = { startOrderEventsConsumer };
