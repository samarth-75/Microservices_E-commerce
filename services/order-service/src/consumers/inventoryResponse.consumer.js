/**
 * Inventory Response Consumer — Order Service
 *
 * Consumes messages from the inventory_events exchange:
 *   - inventory.reserved → update order status to CONFIRMED
 *   - inventory.failed   → update order status to CANCELLED
 *
 * This is the async counterpart to the ORDER_CREATED event.
 * Flow: Order creates (PENDING) → publishes order.created →
 *       Inventory reserves stock → publishes inventory.reserved →
 *       This consumer updates order to CONFIRMED.
 *
 * Acknowledgment strategy:
 *   - ack on success
 *   - nack + requeue on transient errors (DB down)
 *   - ack on permanent errors (order not found) to avoid infinite retries
 */

const { Order } = require('../models');
const { getChannel, QUEUES } = require('../config/rabbitmq');

/**
 * Start consuming inventory response messages.
 * Call this after RabbitMQ connection is established.
 */
function startInventoryResponseConsumer() {
    const channel = getChannel();

    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'order-service',
            message: 'Cannot start inventory response consumer — channel not available',
        }));
        return;
    }

    channel.consume(QUEUES.INVENTORY_RESPONSE, async (msg) => {
        if (!msg) return;

        let event;
        try {
            event = JSON.parse(msg.content.toString());
        } catch (err) {
            // Malformed message — ack to remove from queue (can't retry)
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                message: 'Malformed inventory response message — discarding',
                error: err.message,
            }));
            channel.ack(msg);
            return;
        }

        const routingKey = msg.fields.routingKey;

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'order-service',
            message: 'Processing inventory response',
            routingKey,
            orderId: event.orderId,
        }));

        try {
            const order = await Order.findByPk(event.orderId);

            if (!order) {
                // Order doesn't exist — ack to clear the message
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    service: 'order-service',
                    message: 'Order not found for inventory response — discarding',
                    orderId: event.orderId,
                    routingKey,
                }));
                channel.ack(msg);
                return;
            }

            // Only process if order is still PENDING
            if (order.status !== 'PENDING') {
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'order-service',
                    message: `Order ${order.id} is ${order.status}, not PENDING — skipping inventory response`,
                    orderId: event.orderId,
                    routingKey,
                }));
                channel.ack(msg);
                return;
            }

            if (routingKey === 'inventory.reserved') {
                // Inventory successfully reserved — confirm the order
                order.status = 'CONFIRMED';
                await order.save();

                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    service: 'order-service',
                    message: 'Order confirmed — inventory reserved',
                    orderId: order.id,
                    previousStatus: 'PENDING',
                    newStatus: 'CONFIRMED',
                }));
            } else if (routingKey === 'inventory.failed') {
                // Inventory reservation failed — cancel the order
                order.status = 'CANCELLED';
                await order.save();

                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'order-service',
                    message: 'Order cancelled — inventory reservation failed',
                    orderId: order.id,
                    reason: event.reason || 'Insufficient stock',
                    failedItems: event.failedItems,
                }));
            }

            channel.ack(msg);
        } catch (err) {
            // Transient error (DB down) — nack and requeue for retry
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                message: 'Failed to process inventory response — requeueing',
                orderId: event.orderId,
                routingKey,
                error: err.message,
            }));
            channel.nack(msg, false, true); // requeue
        }
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'order-service',
        message: `Inventory response consumer started on queue: ${QUEUES.INVENTORY_RESPONSE}`,
    }));
}

module.exports = { startInventoryResponseConsumer };
