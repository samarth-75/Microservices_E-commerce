/**
 * Order Cancelled Consumer — Inventory Service
 *
 * Consumes ORDER_CANCELLED events and releases reserved stock back
 * to available. Finds all ACTIVE reservations for the order and:
 *   1. Decrements reservedStock on the Inventory record
 *   2. Marks the Reservation as RELEASED
 *
 * Uses a Sequelize transaction for atomicity.
 */

const { Inventory, Reservation, sequelize } = require('../models');
const { getChannel, QUEUES } = require('../config/rabbitmq');

/**
 * Start consuming order.cancelled messages.
 */
function startOrderCancelledConsumer() {
    const channel = getChannel();

    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'inventory-service',
            message: 'Cannot start order cancelled consumer — channel not available',
        }));
        return;
    }

    channel.consume(QUEUES.ORDER_CANCELLED, async (msg) => {
        if (!msg) return;

        let event;
        try {
            event = JSON.parse(msg.content.toString());
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                message: 'Malformed order cancelled message — discarding',
                error: err.message,
            }));
            channel.ack(msg);
            return;
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'inventory-service',
            message: 'Processing order cancelled event',
            orderId: event.orderId,
        }));

        const transaction = await sequelize.transaction();

        try {
            // Find all ACTIVE reservations for this order
            const reservations = await Reservation.findAll({
                where: {
                    orderId: event.orderId,
                    status: 'ACTIVE',
                },
                transaction,
            });

            if (reservations.length === 0) {
                // No active reservations — order may have been cancelled before
                // inventory was reserved, or reservations already released
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    service: 'inventory-service',
                    message: 'No active reservations to release for cancelled order',
                    orderId: event.orderId,
                }));
                await transaction.commit();
                channel.ack(msg);
                return;
            }

            // Release stock for each reservation
            for (const reservation of reservations) {
                await Inventory.update(
                    {
                        reservedStock: sequelize.literal(
                            `GREATEST("reservedStock" - ${parseInt(reservation.quantity, 10)}, 0)`
                        ),
                    },
                    {
                        where: { productId: reservation.productId },
                        transaction,
                    }
                );

                // Mark reservation as released
                reservation.status = 'RELEASED';
                await reservation.save({ transaction });
            }

            await transaction.commit();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'inventory-service',
                message: 'Stock released for cancelled order',
                orderId: event.orderId,
                releasedItems: reservations.map((r) => ({
                    productId: r.productId,
                    quantity: r.quantity,
                })),
            }));

            channel.ack(msg);
        } catch (err) {
            await transaction.rollback();

            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                message: 'Failed to release stock for cancelled order — requeueing',
                orderId: event.orderId,
                error: err.message,
            }));

            channel.nack(msg, false, true);
        }
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'inventory-service',
        message: `Order cancelled consumer started on queue: ${QUEUES.ORDER_CANCELLED}`,
    }));
}

module.exports = { startOrderCancelledConsumer };
