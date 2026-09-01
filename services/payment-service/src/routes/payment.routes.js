/**
 * Payment Routes — Payment Service
 *
 * Endpoints:
 *   POST   /create-session       Create Stripe Checkout Session (customer)
 *   POST   /webhook              Stripe webhook handler (no auth — Stripe signature)
 *   GET    /:paymentId           Get payment details (customer/admin)
 *   GET    /order/:orderId       Get payment by order ID (customer/admin)
 *   POST   /:paymentId/refund    Initiate refund (admin)
 *
 * Payment flow (Stripe Checkout Session):
 *   1. Customer calls POST /create-session with { orderId }
 *   2. We verify the order is CONFIRMED (REST → order-service)
 *   3. Check idempotency: if payment exists for this orderId, return existing URL
 *   4. Create Stripe Checkout Session with line items
 *   5. Create Payment record (PENDING)
 *   6. Return { sessionUrl } — customer redirects to Stripe's hosted page
 *   7. Stripe fires webhook (checkout.session.completed)
 *   8. We verify signature, update Payment to COMPLETED, update Order to PAID
 *
 * Idempotency:
 *   - orderId IS the idempotency key — one payment per order
 *   - create-session: if Payment exists and is PENDING → return existing session URL
 *   - create-session: if Payment exists and is COMPLETED → return 400 "already paid"
 *   - webhook: if Payment already COMPLETED → ack (200) without processing again
 */

const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

const { Payment } = require('../models');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const {
    createSessionSchema,
    refundSchema,
    validate,
} = require('../validations/payment.validation');
const { getOrder, updateOrderStatus } = require('../utils/orderClient');

// Initialize Stripe with the secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Redirect URLs for Stripe Checkout
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'http://localhost:5173/checkout/success?session_id={CHECKOUT_SESSION_ID}';
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'http://localhost:5173/checkout/cancel';

// -----------------------------------------------------------------------
// POST /create-session — Create Stripe Checkout Session
// -----------------------------------------------------------------------
router.post(
    '/create-session',
    authenticate,
    validate(createSessionSchema),
    async (req, res) => {
        try {
            const { orderId } = req.body;
            const authToken = req.headers.authorization.split(' ')[1];

            // 1. Check idempotency — does a payment already exist for this order?
            const existingPayment = await Payment.findOne({
                where: { orderId },
            });

            if (existingPayment) {
                if (existingPayment.status === 'COMPLETED') {
                    return res.status(400).json({
                        error: 'Already Paid',
                        message: `Order ${orderId} has already been paid.`,
                        paymentId: existingPayment.id,
                    });
                }

                if (existingPayment.status === 'PENDING' && existingPayment.stripeSessionId) {
                    // Return the existing session — customer can retry payment
                    // Retrieve session from Stripe to get the current URL
                    try {
                        const existingSession = await stripe.checkout.sessions.retrieve(
                            existingPayment.stripeSessionId
                        );

                        if (existingSession.status === 'open') {
                            console.log(JSON.stringify({
                                timestamp: new Date().toISOString(),
                                level: 'info',
                                service: 'payment-service',
                                requestId: req.id,
                                message: 'Returning existing Stripe session (idempotent)',
                                orderId,
                                paymentId: existingPayment.id,
                                stripeSessionId: existingPayment.stripeSessionId,
                            }));

                            return res.json({
                                message: 'Existing payment session found. Redirecting to Stripe.',
                                sessionUrl: existingSession.url,
                                paymentId: existingPayment.id,
                            });
                        }

                        // Session expired — create a new one below
                        // Delete the stale payment record so we can create fresh
                        await existingPayment.destroy();
                    } catch (stripeErr) {
                        // Session not found or expired — create a new one
                        await existingPayment.destroy();
                    }
                }

                if (existingPayment.status === 'FAILED') {
                    // Allow retry — delete the failed payment record
                    await existingPayment.destroy();
                }
            }

            // 2. Fetch and verify the order
            let order;
            try {
                order = await getOrder(orderId, authToken);
            } catch (err) {
                return res.status(400).json({
                    error: 'Order Error',
                    message: err.message,
                });
            }

            // 3. Verify the order belongs to this user
            if (order.userId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this order.',
                });
            }

            // 4. Verify the order is in CONFIRMED status
            if (order.status !== 'CONFIRMED') {
                return res.status(400).json({
                    error: 'Invalid Order Status',
                    message: `Order must be in CONFIRMED status to initiate payment. Current status: ${order.status}`,
                });
            }

            // 5. Build Stripe Checkout Session line items from order items
            const lineItems = (order.items || []).map((item) => ({
                price_data: {
                    currency: 'inr',
                    product_data: {
                        name: item.productName,
                        images: item.productImage ? [item.productImage] : [],
                    },
                    unit_amount: Math.round(parseFloat(item.unitPrice) * 100), // Stripe uses paisa/cents
                },
                quantity: item.quantity,
            }));

            // 6. Create Stripe Checkout Session
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'payment',
                line_items: lineItems,
                success_url: STRIPE_SUCCESS_URL,
                cancel_url: STRIPE_CANCEL_URL,
                client_reference_id: orderId,
                customer_email: req.user.email,
                metadata: {
                    orderId,
                    userId: req.user.id,
                },
            });

            // 7. Create Payment record in our database
            const payment = await Payment.create({
                orderId,
                userId: req.user.id,
                stripeSessionId: session.id,
                amount: parseFloat(order.totalAmount),
                currency: 'inr',
                status: 'PENDING',
                idempotencyKey: orderId, // One payment per order
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'payment-service',
                requestId: req.id,
                message: 'Stripe Checkout Session created',
                orderId,
                paymentId: payment.id,
                stripeSessionId: session.id,
                amount: order.totalAmount,
            }));

            res.status(201).json({
                message: 'Payment session created. Redirect customer to Stripe.',
                sessionUrl: session.url,
                sessionId: session.id,
                paymentId: payment.id,
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                requestId: req.id,
                message: 'Failed to create payment session',
                error: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to create payment session.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// POST /webhook — Stripe Webhook Handler
// -----------------------------------------------------------------------
// NOTE: This route does NOT use express.json() — it needs the raw body
// for Stripe signature verification. The raw body is set up in index.js.
router.post(
    '/webhook',
    async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                message: 'STRIPE_WEBHOOK_SECRET not configured — cannot verify webhook',
            }));
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        let event;

        try {
            // Verify the webhook signature using the raw body
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                message: 'Webhook signature verification failed',
                error: err.message,
            }));
            return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'payment-service',
            message: 'Stripe webhook received',
            eventType: event.type,
            eventId: event.id,
        }));

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                await handleCheckoutCompleted(session, event);
                break;
            }

            case 'checkout.session.expired': {
                const session = event.data.object;
                await handleCheckoutExpired(session);
                break;
            }

            default:
                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    service: 'payment-service',
                    message: `Unhandled webhook event type: ${event.type}`,
                    eventId: event.id,
                }));
        }

        // Always return 200 to acknowledge receipt to Stripe
        res.json({ received: true });
    }
);

/**
 * Handle checkout.session.completed — payment succeeded.
 */
async function handleCheckoutCompleted(session, event) {
    try {
        const payment = await Payment.findOne({
            where: { stripeSessionId: session.id },
        });

        if (!payment) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                message: 'Payment record not found for completed session — discarding',
                stripeSessionId: session.id,
            }));
            return;
        }

        // Idempotency check: if already COMPLETED, skip
        if (payment.status === 'COMPLETED') {
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'payment-service',
                message: 'Payment already COMPLETED — webhook is a retry (idempotent skip)',
                paymentId: payment.id,
                orderId: payment.orderId,
            }));
            return;
        }

        // Update payment record
        payment.status = 'COMPLETED';
        payment.stripePaymentIntentId = session.payment_intent;
        payment.metadata = {
            ...payment.metadata,
            checkoutCompleted: {
                eventId: event.id,
                paymentIntent: session.payment_intent,
                customerEmail: session.customer_email,
                amountTotal: session.amount_total,
                currency: session.currency,
                processedAt: new Date().toISOString(),
            },
        };
        await payment.save();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'payment-service',
            message: 'Payment completed — updating order status to PAID',
            paymentId: payment.id,
            orderId: payment.orderId,
            stripePaymentIntentId: session.payment_intent,
        }));

        // Update order status to PAID via Order Service (synchronous REST)
        try {
            await updateOrderStatus(payment.orderId, 'PAID');

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'payment-service',
                message: 'Order status updated to PAID',
                orderId: payment.orderId,
            }));
        } catch (orderErr) {
            // Payment is confirmed but order update failed.
            // This is a critical inconsistency — log it for manual resolution.
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                message: 'CRITICAL: Payment completed but failed to update order to PAID',
                paymentId: payment.id,
                orderId: payment.orderId,
                error: orderErr.message,
            }));
            // In production: trigger an alert, add to a reconciliation queue
        }
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'payment-service',
            message: 'Error processing checkout.session.completed',
            error: err.message,
        }));
    }
}

/**
 * Handle checkout.session.expired — session timed out, payment never completed.
 */
async function handleCheckoutExpired(session) {
    try {
        const payment = await Payment.findOne({
            where: { stripeSessionId: session.id },
        });

        if (!payment || payment.status !== 'PENDING') {
            return; // Nothing to do
        }

        payment.status = 'FAILED';
        payment.metadata = {
            ...payment.metadata,
            expired: {
                reason: 'Checkout session expired',
                expiredAt: new Date().toISOString(),
            },
        };
        await payment.save();

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'payment-service',
            message: 'Payment marked as FAILED — checkout session expired',
            paymentId: payment.id,
            orderId: payment.orderId,
        }));
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'payment-service',
            message: 'Error processing checkout.session.expired',
            error: err.message,
        }));
    }
}

// -----------------------------------------------------------------------
// GET /:paymentId — Get payment details
// -----------------------------------------------------------------------
router.get(
    '/:paymentId',
    authenticate,
    async (req, res) => {
        try {
            const payment = await Payment.findByPk(req.params.paymentId);

            if (!payment) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Payment not found.',
                });
            }

            // Customers can only see their own payments
            if (req.user.role !== 'admin' && payment.userId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this payment.',
                });
            }

            res.json({ payment });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                requestId: req.id,
                message: 'Failed to get payment',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve payment.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// GET /order/:orderId — Get payment by order ID
// -----------------------------------------------------------------------
router.get(
    '/order/:orderId',
    authenticate,
    async (req, res) => {
        try {
            const payment = await Payment.findOne({
                where: { orderId: req.params.orderId },
            });

            if (!payment) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `No payment found for order ${req.params.orderId}`,
                });
            }

            // Customers can only see their own payments
            if (req.user.role !== 'admin' && payment.userId !== req.user.id) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this payment.',
                });
            }

            res.json({ payment });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                requestId: req.id,
                message: 'Failed to get payment by order',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve payment.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// POST /:paymentId/refund — Initiate refund (admin only)
// -----------------------------------------------------------------------
router.post(
    '/:paymentId/refund',
    authenticate,
    authorize('admin'),
    validate(refundSchema),
    async (req, res) => {
        try {
            const payment = await Payment.findByPk(req.params.paymentId);

            if (!payment) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Payment not found.',
                });
            }

            if (payment.status !== 'COMPLETED') {
                return res.status(400).json({
                    error: 'Invalid Payment Status',
                    message: `Only COMPLETED payments can be refunded. Current status: ${payment.status}`,
                });
            }

            if (!payment.stripePaymentIntentId) {
                return res.status(400).json({
                    error: 'Missing Payment Intent',
                    message: 'Cannot refund — Stripe PaymentIntent ID not available.',
                });
            }

            // Initiate refund via Stripe API
            const refund = await stripe.refunds.create({
                payment_intent: payment.stripePaymentIntentId,
                reason: req.body.reason || 'requested_by_customer',
            });

            // Update payment record
            payment.status = 'REFUNDED';
            payment.stripeRefundId = refund.id;
            payment.metadata = {
                ...payment.metadata,
                refund: {
                    refundId: refund.id,
                    reason: req.body.reason,
                    amount: refund.amount,
                    currency: refund.currency,
                    initiatedBy: req.user.id,
                    processedAt: new Date().toISOString(),
                },
            };
            await payment.save();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'payment-service',
                requestId: req.id,
                message: 'Refund processed',
                paymentId: payment.id,
                orderId: payment.orderId,
                stripeRefundId: refund.id,
                adminId: req.user.id,
            }));

            res.json({
                message: 'Refund processed successfully.',
                payment: {
                    id: payment.id,
                    orderId: payment.orderId,
                    status: payment.status,
                    stripeRefundId: payment.stripeRefundId,
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'payment-service',
                requestId: req.id,
                message: 'Failed to process refund',
                error: err.message,
            }));

            // Handle Stripe-specific errors
            if (err.type === 'StripeInvalidRequestError') {
                return res.status(400).json({
                    error: 'Stripe Error',
                    message: err.message,
                });
            }

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to process refund.',
            });
        }
    }
);

module.exports = router;
