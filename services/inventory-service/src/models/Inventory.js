/**
 * Inventory Model — Inventory Service
 *
 * Tracks stock levels for each product. Uses a reservation pattern:
 *   totalStock = total units in warehouse
 *   reservedStock = units reserved for pending orders
 *   availableStock = totalStock - reservedStock (virtual field)
 *
 * productId is a string because it's a MongoDB ObjectId from the Catalog
 * Service — stored as-is, not a FK (database-per-service pattern).
 *
 * Stock reservation uses an atomic SQL UPDATE with a WHERE clause that
 * checks available stock, preventing overselling without application-level
 * locks. See orderCreated.consumer.js for the implementation.
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Inventory = sequelize.define('Inventory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    productId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'MongoDB ObjectId from catalog — stored as string',
    },
    totalStock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
            min: 0,
        },
    },
    reservedStock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
            min: 0,
        },
    },
    lowStockThreshold: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
        comment: 'Threshold for low-stock notifications (future use)',
    },
}, {
    tableName: 'inventory',
    timestamps: true,
    indexes: [
        { unique: true, fields: ['productId'] },
    ],
    // Virtual field — computed, not stored in DB
    getterMethods: {
        availableStock() {
            return this.getDataValue('totalStock') - this.getDataValue('reservedStock');
        },
    },
});

module.exports = Inventory;
