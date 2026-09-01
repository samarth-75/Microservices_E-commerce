/**
 * Order Routes — Order Service
 *
 * Endpoints:
 *   POST   /           Create order from cart (customer)
 *   GET    /           List user's orders (customer) or all orders (admin)
 *   GET    /:id        Get order details with items
 *   PUT    /:id/status Update order status (admin)
 *   PUT    /:id/cancel Cancel order (customer, only if PENDING)
 *
 * Order creation flow:
 *   1. Fetch user's cart from cart-service (REST)
 *   2. Re-validate product prices from catalog-service (REST)
 *   3. Create Order + OrderItems in PostgreSQL (transaction)
 *   4. Publish ORDER_CREATED event to RabbitMQ
 *   5. Clear user's cart via cart-service (REST, non-fatal on failure)
 *   6. Return 201 with order details
 */

const express = require('express');
const router = express.Router();

const { Order, OrderItem, sequelize } = require('../models');
const { STATUS_TRANSITIONS } = require('../models/Order');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const {
    createOrderSchema,
    updateStatusSchema,
    listOrdersSchema,
    validate,
} = require('../validations/order.validation');
const { getCart, clearCart } = require('../utils/cartClient');
const { validateAndPriceItems } = require('../utils/catalogClient');
const { publishEvent, EXCHANGES, ROUTING_KEYS } = require('../config/rabbitmq');

// -----------------------------------------------------------------------
// POST / — Create order from cart
// -----------------------------------------------------------------------
router.post(
    '/',
    authenticate,
    validate(createOrderSchema),
    async (req, res) => {
        const transaction = await sequelize.transaction();

        try {
            // 1. Extract auth token to forward to cart-service
            const authToken = req.headers.authorization.split(' ')[1];

            // 2. Fetch user's cart
            const cartData = await getCart(authToken);

            if (!cartData || !cartData.items || cartData.items.length === 0) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'Empty Cart',
                    message: 'Cannot create an order with an empty cart. Add items first.',
                });
            }

            // 3. Re-validate product prices from catalog
            let validatedItems;
            try {
                validatedItems = await validateAndPriceItems(cartData.items);
            } catch (err) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'Product Validation Failed',
                    message: err.message,
                });
            }

            // 4. Calculate total amount
            const totalAmount = validatedItems.reduce(
                (sum, item) => sum + item.totalPrice,
                0
            );

            // 5. Create the order
            const order = await Order.create(
                {
                    userId: req.user.id,
                    status: 'PENDING',
                    totalAmount: parseFloat(totalAmount.toFixed(2)),
                    shippingAddress: req.body.shippingAddress,
                    notes: req.body.notes || null,
                },
                { transaction }
            );

            // 6. Create order items
            const orderItems = await OrderItem.bulkCreate(
                validatedItems.map((item) => ({
                    orderId: order.id,
                    productId: item.productId,
                    productName: item.productName,
                    productImage: item.productImage,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    totalPrice: item.totalPrice,
                })),
                { transaction }
            );

            await transaction.commit();

            // 7. Publish ORDER_CREATED event to RabbitMQ
            publishEvent(EXCHANGES.ORDER_EVENTS, ROUTING_KEYS.ORDER_CREATED, {
                orderId: order.id,
                userId: req.user.id,
                items: validatedItems.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                })),
                totalAmount: order.totalAmount,
                timestamp: new Date().toISOString(),
            });

            // 8. Clear the user's cart (non-fatal — order already created)
            clearCart(authToken);

            // 9. Return the created order
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'order-service',
                requestId: req.id,
                message: 'Order created',
                orderId: order.id,
                userId: req.user.id,
                itemCount: orderItems.length,
                totalAmount: order.totalAmount,
            }));

            res.status(201).json({
                message: 'Order created successfully. Awaiting inventory confirmation.',
                order: {
                    id: order.id,
                    status: order.status,
                    totalAmount: order.totalAmount,
                    shippingAddress: order.shippingAddress,
                    notes: order.notes,
                    items: orderItems.map((item) => ({
                        id: item.id,
                        productId: item.productId,
                        productName: item.productName,
                        productImage: item.productImage,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        totalPrice: item.totalPrice,
                    })),
                    createdAt: order.createdAt,
                },
            });
        } catch (err) {
            await transaction.rollback();

            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                requestId: req.id,
                message: 'Failed to create order',
                error: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to create order. Please try again.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// GET / — List orders
// -----------------------------------------------------------------------
router.get(
    '/',
    authenticate,
    validate(listOrdersSchema, 'query'),
    async (req, res) => {
        try {
            const { page, limit, status } = req.query;
            const offset = (page - 1) * limit;

            // Build where clause
            const where = {};

            // Customers see only their orders; admins see all
            if (req.user.role !== 'admin') {
                where.userId = req.user.id;
            }

            if (status) {
                where.status = status;
            }

            const { count, rows: orders } = await Order.findAndCountAll({
                where,
                include: [{
                    model: OrderItem,
                    as: 'items',
                }],
                order: [['createdAt', 'DESC']],
                limit,
                offset,
            });

            res.json({
                orders,
                pagination: {
                    page,
                    limit,
                    totalItems: count,
                    totalPages: Math.ceil(count / limit),
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                requestId: req.id,
                message: 'Failed to list orders',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve orders.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// GET /:id — Get order details
// -----------------------------------------------------------------------
router.get(
    '/:id',
    authenticate,
    async (req, res) => {
        try {
            const order = await Order.findByPk(req.params.id, {
                include: [{
                    model: OrderItem,
                    as: 'items',
                }],
            });

            if (!order) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Order not found.',
                });
            }

            // Customers can only see their own orders
            if (req.user.role !== 'admin' && order.userId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this order.',
                });
            }

            res.json({ order });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                requestId: req.id,
                message: 'Failed to get order',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve order.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// PUT /:id/status — Admin update order status
// -----------------------------------------------------------------------
router.put(
    '/:id/status',
    authenticate,
    authorize('admin'),
    validate(updateStatusSchema),
    async (req, res) => {
        try {
            const order = await Order.findByPk(req.params.id);

            if (!order) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Order not found.',
                });
            }

            // Validate status transition
            const allowedTransitions = STATUS_TRANSITIONS[order.status];
            if (!allowedTransitions || !allowedTransitions.includes(req.body.status)) {
                return res.status(400).json({
                    error: 'Invalid Status Transition',
                    message: `Cannot transition from ${order.status} to ${req.body.status}. Allowed: ${allowedTransitions?.join(', ') || 'none (terminal state)'}`,
                });
            }

            const previousStatus = order.status;
            order.status = req.body.status;
            await order.save();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'order-service',
                requestId: req.id,
                message: 'Order status updated',
                orderId: order.id,
                previousStatus,
                newStatus: order.status,
                adminId: req.user.id,
            }));

            // Publish cancellation event if order was cancelled (for inventory release)
            if (order.status === 'CANCELLED') {
                publishEvent(EXCHANGES.ORDER_EVENTS, ROUTING_KEYS.ORDER_CANCELLED, {
                    orderId: order.id,
                    userId: order.userId,
                    previousStatus,
                    timestamp: new Date().toISOString(),
                });
            }

            res.json({
                message: `Order status updated from ${previousStatus} to ${order.status}`,
                order: {
                    id: order.id,
                    status: order.status,
                    updatedAt: order.updatedAt,
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                requestId: req.id,
                message: 'Failed to update order status',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to update order status.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// PUT /:id/cancel — Customer cancel order (only PENDING)
// -----------------------------------------------------------------------
router.put(
    '/:id/cancel',
    authenticate,
    async (req, res) => {
        try {
            const order = await Order.findByPk(req.params.id);

            if (!order) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Order not found.',
                });
            }

            // Customers can only cancel their own orders
            if (order.userId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this order.',
                });
            }

            // Can only cancel PENDING or CONFIRMED orders
            if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
                return res.status(400).json({
                    error: 'Cannot Cancel',
                    message: `Orders with status ${order.status} cannot be cancelled. Only PENDING or CONFIRMED orders can be cancelled.`,
                });
            }

            const previousStatus = order.status;
            order.status = 'CANCELLED';
            await order.save();

            // Publish cancellation event for inventory release
            publishEvent(EXCHANGES.ORDER_EVENTS, ROUTING_KEYS.ORDER_CANCELLED, {
                orderId: order.id,
                userId: order.userId,
                previousStatus,
                timestamp: new Date().toISOString(),
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'order-service',
                requestId: req.id,
                message: 'Order cancelled by customer',
                orderId: order.id,
                userId: req.user.id,
                previousStatus,
            }));

            res.json({
                message: 'Order cancelled successfully.',
                order: {
                    id: order.id,
                    status: order.status,
                    updatedAt: order.updatedAt,
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                requestId: req.id,
                message: 'Failed to cancel order',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to cancel order.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// POST /:id/pay — Initiate payment for a CONFIRMED order
// -----------------------------------------------------------------------
router.post(
    '/:id/pay',
    authenticate,
    async (req, res) => {
        try {
            const order = await Order.findByPk(req.params.id);

            if (!order) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Order not found.',
                });
            }

            // Customers can only pay for their own orders
            if (order.userId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this order.',
                });
            }

            // Can only pay for CONFIRMED orders
            if (order.status !== 'CONFIRMED') {
                return res.status(400).json({
                    error: 'Invalid Order Status',
                    message: `Order must be CONFIRMED to initiate payment. Current status: ${order.status}`,
                });
            }

            // Forward to Payment Service
            const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3006';
            const authToken = req.headers.authorization.split(' ')[1];

            const response = await fetch(`${PAYMENT_SERVICE_URL}/payments/create-session`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ orderId: order.id }),
                signal: AbortSignal.timeout(10000),
            });

            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json(data);
            }

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'order-service',
                requestId: req.id,
                message: 'Payment session created via payment-service',
                orderId: order.id,
                sessionUrl: data.sessionUrl,
            }));

            res.json({
                message: 'Payment session created. Redirect to Stripe to complete payment.',
                sessionUrl: data.sessionUrl,
                sessionId: data.sessionId,
                paymentId: data.paymentId,
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'order-service',
                requestId: req.id,
                message: 'Failed to initiate payment',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to initiate payment.',
            });
        }
    }
);

module.exports = router;
