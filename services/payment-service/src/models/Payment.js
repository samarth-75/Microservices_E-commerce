/**
 * Payment Model — Payment Service
 *
 * Tracks payment records for orders. Key design decisions:
 *
 * 1. idempotencyKey = orderId — one payment per order. If a second
 *    create-session request arrives for the same order, we return the
 *    existing Stripe session URL instead of creating a duplicate.
 *
 * 2. stripeSessionId — the Stripe Checkout Session ID. Used to look up
 *    the payment when the webhook fires (checkout.session.completed).
 *
 * 3. stripePaymentIntentId — extracted from the webhook event payload.
 *    Needed for refunds (Stripe refunds target the PaymentIntent, not
 *    the Checkout Session).
 *
 * 4. metadata — raw Stripe event data stored as JSONB for audit trail.
 *    In a dispute, you can reconstruct exactly what Stripe told you.
 *
 * Status lifecycle:
 *   PENDING    → payment created, awaiting Stripe confirmation
 *   COMPLETED  → Stripe webhook confirmed payment
 *   FAILED     → Stripe webhook reported failure
 *   REFUNDED   → admin-initiated refund via Stripe API
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'];

const Payment = sequelize.define('Payment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Order UUID from order-service — not a FK (different DB)',
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'User UUID from JWT — not a FK (different DB)',
    },
    stripeSessionId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: 'Stripe Checkout Session ID',
    },
    stripePaymentIntentId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Stripe PaymentIntent ID — needed for refunds',
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'inr',
    },
    status: {
        type: DataTypes.ENUM(...PAYMENT_STATUSES),
        defaultValue: 'PENDING',
        allowNull: false,
    },
    idempotencyKey: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'orderId is the idempotency key — one payment per order',
    },
    stripeRefundId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Stripe Refund ID — set when refund is processed',
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
        comment: 'Raw Stripe event data for audit trail',
    },
}, {
    tableName: 'payments',
    timestamps: true,
    indexes: [
        { unique: true, fields: ['orderId'] },
        { unique: true, fields: ['stripeSessionId'] },
        { unique: true, fields: ['idempotencyKey'] },
        { fields: ['userId'] },
        { fields: ['status'] },
    ],
});

module.exports = Payment;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
