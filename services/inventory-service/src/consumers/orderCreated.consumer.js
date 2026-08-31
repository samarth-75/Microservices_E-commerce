/**
 * Order Created Consumer — Inventory Service
 *
 * Consumes ORDER_CREATED events from RabbitMQ and attempts to reserve
 * stock for all items in the order.
 *
 * Reservation logic (atomic):
 *   1. Start a Sequelize transaction
 *   2. For each order item:
 *      - Atomic UPDATE: SET reservedStock = reservedStock + qty
 *        WHERE productId = :pid AND totalStock - reservedStock >= qty
 *      - If UPDATE affects 0 rows → insufficient stock
 *   3. If ALL items reserved:
 *      - Create Reservation records for each item
 *      - Commit transaction
 *      - Publish inventory.reserved
 *   4. If ANY item fails:
 *      - Rollback transaction (no partial reservations)
 *      - Publish inventory.failed with details
 *
 * Why atomic UPDATE instead of SELECT + UPDATE?
 *   - SELECT then UPDATE has a race condition: two concurrent orders could
 *     both SELECT available=5, both try to reserve 3, resulting in -1.
 *   - The WHERE clause in the UPDATE acts as a database-level lock:
 *     only one transaction can succeed for the last units.
 *   - This is the "optimistic locking" pattern — no explicit locks needed.
 */

const { Inventory, Reservation, sequelize } = require('../models');
const { getChannel, publishEvent, QUEUES, EXCHANGES, ROUTING_KEYS } = require('../config/rabbitmq');

/**
 * Start consuming order.created messages.
 */
function startOrderCreatedConsumer() {
    const channel = getChannel();

    if (!channel) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'inventory-service',
            message: 'Cannot start order created consumer — channel not available',
        }));
        return;
    }

    channel.consume(QUEUES.ORDER_CREATED, async (msg) => {
        if (!msg) return;

        let event;
        try {
            event = JSON.parse(msg.content.toString());
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                message: 'Malformed order created message — discarding',
                error: err.message,
            }));
            channel.ack(msg);
            return;
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'inventory-service',
            message: 'Processing order created event',
            orderId: event.orderId,
            itemCount: event.items?.length,
        }));

        const transaction = await sequelize.transaction();

        try {
            const failedItems = [];
            const reservedItems = [];

            for (const item of event.items) {
                // Atomic reservation: UPDATE with WHERE checks available stock
                const [affectedRows] = await Inventory.update(
                    {
                        reservedStock: sequelize.literal(`"reservedStock" + ${parseInt(item.quantity, 10)}`),
                    },
                    {
                        where: {
                            productId: item.productId,
                            // Only reserve if enough stock is available
                            // totalStock - reservedStock >= requested quantity
                            [require('sequelize').Op.and]: [
                                sequelize.where(
                                    sequelize.literal(`"totalStock" - "reservedStock"`),
                                    '>=',
                                    parseInt(item.quantity, 10)
                                ),
                            ],
                        },
                        transaction,
                    }
                );

                if (affectedRows === 0) {
                    // Insufficient stock or product not in inventory
                    const existing = await Inventory.findOne({
                        where: { productId: item.productId },
                        transaction,
                    });

                    failedItems.push({
                        productId: item.productId,
                        requestedQuantity: item.quantity,
                        availableStock: existing
                            ? existing.totalStock - existing.reservedStock
                            : 0,
                        reason: existing
                            ? 'Insufficient stock'
                            : 'Product not found in inventory',
                    });
                } else {
                    reservedItems.push({
                        productId: item.productId,
                        quantity: item.quantity,
                    });
                }
            }

            if (failedItems.length > 0) {
                // Rollback ALL reservations — no partial fulfillment
                await transaction.rollback();

                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'warn',
                    service: 'inventory-service',
                    message: 'Inventory reservation failed — rolling back',
                    orderId: event.orderId,
                    failedItems,
                }));

                // Publish failure event
                publishEvent(EXCHANGES.INVENTORY_EVENTS, ROUTING_KEYS.INVENTORY_FAILED, {
                    orderId: event.orderId,
                    userId: event.userId,
                    reason: 'Insufficient stock for one or more items',
                    failedItems,
                    timestamp: new Date().toISOString(),
                });

                channel.ack(msg);
                return;
            }

            // All items reserved — create Reservation records for tracking
            for (const item of reservedItems) {
                await Reservation.create(
                    {
                        orderId: event.orderId,
                        productId: item.productId,
                        quantity: item.quantity,
                        status: 'ACTIVE',
                    },
                    { transaction }
                );
            }

            await transaction.commit();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'inventory-service',
                message: 'Inventory reserved successfully',
                orderId: event.orderId,
                reservedItems,
            }));

            // Publish success event
            publishEvent(EXCHANGES.INVENTORY_EVENTS, ROUTING_KEYS.INVENTORY_RESERVED, {
                orderId: event.orderId,
                userId: event.userId,
                reservedItems,
                timestamp: new Date().toISOString(),
            });

            channel.ack(msg);
        } catch (err) {
            await transaction.rollback();

            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                message: 'Failed to process order created event — requeueing',
                orderId: event.orderId,
                error: err.message,
            }));

            // Transient error — requeue for retry
            channel.nack(msg, false, true);
        }
    });

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'inventory-service',
        message: `Order created consumer started on queue: ${QUEUES.ORDER_CREATED}`,
    }));
}

module.exports = { startOrderCreatedConsumer };
