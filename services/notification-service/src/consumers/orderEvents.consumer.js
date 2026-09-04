/**
 * CommerceSphere Notification Service — Order Events Consumer
 *
 * Consumes order.created and order.cancelled events from the order_events
 * exchange via the notification.order_events queue.
 *
 * Each event triggers a simulated notification (email + SMS) to the customer.
 */

const { getChannel, QUEUES } = require('../config/rabbitmq');
const { notifyUser } = require('../services/notifier');

/**
 * Start consuming order events.
 */
function startOrderEventsConsumer() {
    const channel = getChannel();

    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'notification-service',
            message: 'Cannot start order events consumer — channel not available',
        }));
        return;
    }

    channel.consume(QUEUES.ORDER_NOTIFICATIONS, async (msg) => {
        if (!msg) return;

        try {
            const event = JSON.parse(msg.content.toString());
            const routingKey = msg.fields.routingKey;

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'notification-service',
                message: 'Received order event',
                routingKey,
                orderId: event.orderId,
            }));

            switch (routingKey) {
                case 'order.created':
                    handleOrderCreated(event);
                    break;

                case 'order.cancelled':
                    handleOrderCancelled(event);
                    break;

                default:
                    console.warn(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        level: 'warn',
                        service: 'notification-service',
                        message: `Unknown order event routing key: ${routingKey}`,
                    }));
            }

            // Acknowledge the message
            channel.ack(msg);
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'notification-service',
                message: 'Failed to process order event',
                error: err.message,
            }));

            // Reject and requeue on failure (will retry)
            channel.nack(msg, false, true);
        }
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'notification-service',
        message: `Order events consumer started on queue: ${QUEUES.ORDER_NOTIFICATIONS}`,
    }));
}

/**
 * Handle order.created event — notify customer their order was received.
 */
function handleOrderCreated(event) {
    const { orderId, userId, items, totalAmount } = event;
    const itemCount = items ? items.length : 0;

    notifyUser({
        userId,
        email: `user-${userId}@example.com`,     // Simulated — real system would look up from User Service
        phone: '+91-XXXXXXXXXX',                   // Simulated
        subject: `Order #${orderId.slice(0, 8)} — Received!`,
        body: `Your order with ${itemCount} item(s) totaling ₹${totalAmount || 'N/A'} has been received. We're processing it now. You'll receive updates as your order progresses.`,
        metadata: { orderId, userId, event: 'order.created' },
    });
}

/**
 * Handle order.cancelled event — notify customer their order was cancelled.
 */
function handleOrderCancelled(event) {
    const { orderId, userId, reason } = event;

    notifyUser({
        userId,
        email: `user-${userId}@example.com`,
        phone: '+91-XXXXXXXXXX',
        subject: `Order #${orderId.slice(0, 8)} — Cancelled`,
        body: `Your order has been cancelled.${reason ? ` Reason: ${reason}` : ''} If you didn't request this cancellation, please contact support.`,
        metadata: { orderId, userId, event: 'order.cancelled', reason },
    });
}

module.exports = { startOrderEventsConsumer };
