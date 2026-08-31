/**
 * Order Model — Order Service
 *
 * Represents a customer order. Status follows a strict lifecycle:
 *   PENDING → CONFIRMED → PAID → SHIPPED → DELIVERED
 *   PENDING → CANCELLED (customer-initiated)
 *   PENDING → CANCELLED (inventory failure — auto)
 *
 * Why JSONB for shippingAddress?
 *   - Address shape may vary (apartment vs. house, international vs. domestic)
 *   - JSONB allows flexible querying without an extra table
 *   - Still indexed and queryable in PostgreSQL
 *
 * userId is NOT a foreign key — the User table lives in a different database
 * (database-per-service pattern). We store the user's UUID from the JWT.
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

// Valid status transitions — enforced at the route level, documented here
// for reference. Key = current status, value = allowed next statuses.
const STATUS_TRANSITIONS = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['PAID', 'CANCELLED'],
    PAID: ['SHIPPED'],      // immutable after PAID — no cancellation
    SHIPPED: ['DELIVERED'],
    DELIVERED: [],           // terminal state
    CANCELLED: [],           // terminal state
};

const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'User UUID from JWT — not a FK (different DB)',
    },
    status: {
        type: DataTypes.ENUM(...ORDER_STATUSES),
        defaultValue: 'PENDING',
        allowNull: false,
    },
    totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
    },
    shippingAddress: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: 'JSON: { street, city, state, zip, country }',
    },
    paymentId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Set when payment completes (Phase 5)',
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
}, {
    tableName: 'orders',
    timestamps: true,
    indexes: [
        { fields: ['userId'] },
        { fields: ['status'] },
        { fields: ['createdAt'] },
    ],
});

module.exports = Order;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
module.exports.STATUS_TRANSITIONS = STATUS_TRANSITIONS;
