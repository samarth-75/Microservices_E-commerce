/**
 * OrderItem Model — Order Service
 *
 * Represents a single line item within an order. Snapshots product data
 * (name, image, price) at order time so the order record is self-contained
 * and doesn't break if the catalog product changes later.
 *
 * productId is a string because it's a MongoDB ObjectId from the Catalog
 * Service — stored as-is, not a FK (database-per-service pattern).
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrderItem = sequelize.define('OrderItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'FK → Order.id',
    },
    productId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'MongoDB ObjectId from catalog — stored as string',
    },
    productName: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Snapshot at order time',
    },
    productImage: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Snapshot — first image URL at order time',
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            min: 1,
        },
    },
    unitPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Re-validated from catalog at checkout time',
    },
    totalPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'quantity × unitPrice — computed at order creation',
    },
}, {
    tableName: 'order_items',
    timestamps: true,
    indexes: [
        { fields: ['orderId'] },
        { fields: ['productId'] },
    ],
});

module.exports = OrderItem;
