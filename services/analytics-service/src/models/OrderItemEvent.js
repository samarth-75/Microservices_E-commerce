/**
 * CommerceSphere Analytics Service — OrderItemEvent Model
 *
 * Stores per-item data for each order, enabling "top products" queries.
 * Each row is one product from one order — denormalized for fast aggregation.
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrderItemEvent = sequelize.define('OrderItemEvent', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },

    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
    },

    productId: {
        type: DataTypes.STRING,
        allowNull: false,
    },

    productName: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Unknown Product',
    },

    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },

    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
    },
}, {
    tableName: 'order_item_events',
    timestamps: true,
    indexes: [
        { fields: ['productId'] },  // For top products aggregation
        { fields: ['orderId'] },    // For joining with OrderEvent
    ],
});

module.exports = OrderItemEvent;
