/**
 * CommerceSphere Analytics Service — OrderEvent Model
 *
 * Stores a denormalized snapshot of each order event for analytics queries.
 * This is NOT a copy of the Order table — it's an analytics-specific projection
 * built from RabbitMQ events. The Analytics Service never reads from the
 * Order Service's database (database-per-service pattern).
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrderEvent = sequelize.define('OrderEvent', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },

    // The original order ID from Order Service
    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true, // One analytics record per order (idempotent)
    },

    userId: {
        type: DataTypes.UUID,
        allowNull: false,
    },

    totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
    },

    itemCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },

    // Track order status changes for analytics
    status: {
        type: DataTypes.ENUM('CREATED', 'CANCELLED'),
        allowNull: false,
        defaultValue: 'CREATED',
    },

    // When the original order was placed (from the event, not when we received it)
    orderDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'order_events',
    timestamps: true,
    indexes: [
        { fields: ['orderDate'] },   // For date range queries
        { fields: ['userId'] },       // For per-user analytics
        { fields: ['status'] },       // For filtering active vs cancelled
    ],
});

module.exports = OrderEvent;
