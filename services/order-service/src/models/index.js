/**
 * Models Index — Order Service
 *
 * Imports all models, sets up associations, and re-exports everything
 * so the rest of the app can do:
 *   const { Order, OrderItem, sequelize } = require('./models');
 */

const sequelize = require('../config/database');
const Order = require('./Order');
const OrderItem = require('./OrderItem');

// ---- Associations ----
// An order has many line items. When an order is deleted, cascade-delete
// its items (though orders are rarely deleted — they're cancelled instead).
Order.hasMany(OrderItem, {
    foreignKey: 'orderId',
    as: 'items',
    onDelete: 'CASCADE',
});

OrderItem.belongsTo(Order, {
    foreignKey: 'orderId',
    as: 'order',
});

module.exports = { sequelize, Order, OrderItem };
