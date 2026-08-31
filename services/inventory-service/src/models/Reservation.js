/**
 * Reservation Model — Inventory Service
 *
 * Tracks per-order stock reservations so they can be properly released
 * on cancellation. Without this, we'd have no way to know how much
 * reserved stock belongs to which order.
 *
 * Status lifecycle:
 *   ACTIVE    — stock reserved, order pending
 *   CONFIRMED — order paid, stock permanently deducted
 *   RELEASED  — order cancelled, stock returned to available
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RESERVATION_STATUSES = ['ACTIVE', 'CONFIRMED', 'RELEASED'];

const Reservation = sequelize.define('Reservation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Order UUID from order-service',
    },
    productId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'MongoDB ObjectId from catalog',
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
            min: 1,
        },
    },
    status: {
        type: DataTypes.ENUM(...RESERVATION_STATUSES),
        defaultValue: 'ACTIVE',
        allowNull: false,
    },
}, {
    tableName: 'reservations',
    timestamps: true,
    indexes: [
        { fields: ['orderId'] },
        { fields: ['productId'] },
        { fields: ['status'] },
    ],
});

module.exports = Reservation;
module.exports.RESERVATION_STATUSES = RESERVATION_STATUSES;
