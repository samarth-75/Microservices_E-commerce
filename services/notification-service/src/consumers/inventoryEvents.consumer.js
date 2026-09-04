/**
 * CommerceSphere Notification Service — Inventory Events Consumer
 *
 * Consumes inventory.reserved and inventory.failed events from the
 * inventory_events exchange via the notification.inventory_events queue.
 *
 * These events represent the outcome of the inventory reservation step
 * in the order pipeline. Customers get notified about:
 *   - inventory.reserved → "Your order is confirmed!"
 *   - inventory.failed → "Sorry, some items are out of stock."
 */

const { getChannel, QUEUES } = require('../config/rabbitmq');
const { notifyUser } = require('../services/notifier');

/**
 * Start consuming inventory events.
 */
function startInventoryEventsConsumer() {
    const channel = getChannel();

    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'notification-service',
            message: 'Cannot start inventory events consumer — channel not available',
        }));
        return;
    }

    channel.consume(QUEUES.INVENTORY_NOTIFICATIONS, async (msg) => {
        if (!msg) return;

        try {
            const event = JSON.parse(msg.content.toString());
            const routingKey = msg.fields.routingKey;

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'notification-service',
                message: 'Received inventory event',
                routingKey,
                orderId: event.orderId,
            }));

            switch (routingKey) {
                case 'inventory.reserved':
                    handleInventoryReserved(event);
                    break;

                case 'inventory.failed':
                    handleInventoryFailed(event);
                    break;

                default:
                    console.warn(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        level: 'warn',
                        service: 'notification-service',
                        message: `Unknown inventory event routing key: ${routingKey}`,
                    }));
            }

            channel.ack(msg);
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'notification-service',
                message: 'Failed to process inventory event',
                error: err.message,
            }));

            channel.nack(msg, false, true);
        }
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'notification-service',
        message: `Inventory events consumer started on queue: ${QUEUES.INVENTORY_NOTIFICATIONS}`,
    }));
}

/**
 * Handle inventory.reserved — order confirmed, stock reserved.
 */
function handleInventoryReserved(event) {
    const { orderId, userId } = event;

    notifyUser({
        userId,
        email: `user-${userId}@example.com`,
        phone: '+91-XXXXXXXXXX',
        subject: `Order #${orderId.slice(0, 8)} — Confirmed!`,
        body: `Great news! Your order has been confirmed and inventory has been reserved. You can now proceed to payment.`,
        metadata: { orderId, userId, event: 'inventory.reserved' },
    });
}

/**
 * Handle inventory.failed — some items out of stock.
 */
function handleInventoryFailed(event) {
    const { orderId, userId, reason } = event;

    notifyUser({
        userId,
        email: `user-${userId}@example.com`,
        phone: '+91-XXXXXXXXXX',
        subject: `Order #${orderId.slice(0, 8)} — Stock Issue`,
        body: `We're sorry, but we couldn't reserve all items in your order.${reason ? ` Details: ${reason}` : ''} Your order has been updated. Please check your order status.`,
        metadata: { orderId, userId, event: 'inventory.failed', reason },
    });
}

module.exports = { startInventoryEventsConsumer };
