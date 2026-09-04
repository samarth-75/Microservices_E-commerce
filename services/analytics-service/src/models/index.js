/**
 * CommerceSphere Analytics Service — Model Index
 *
 * Centralizes model imports and sets up associations.
 */

const sequelize = require('../config/database');
const OrderEvent = require('./OrderEvent');
const OrderItemEvent = require('./OrderItemEvent');

// Associations
OrderEvent.hasMany(OrderItemEvent, {
    foreignKey: 'orderId',
    sourceKey: 'orderId',
    as: 'items',
});

OrderItemEvent.belongsTo(OrderEvent, {
    foreignKey: 'orderId',
    targetKey: 'orderId',
    as: 'order',
});

module.exports = {
    sequelize,
    OrderEvent,
    OrderItemEvent,
};
