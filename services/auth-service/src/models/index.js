/**
 * Models Index — Auth Service
 *
 * Imports all models, sets up associations, and re-exports everything
 * so the rest of the app can do: const { User, RefreshToken, sequelize } = require('./models');
 */

const sequelize = require('../config/database');
const User = require('./User');
const RefreshToken = require('./RefreshToken');

// ---- Associations ----
// A user can have many refresh tokens (one per device/session).
// When a user is deleted, cascade-delete their tokens.
User.hasMany(RefreshToken, {
    foreignKey: 'userId',
    as: 'refreshTokens',
    onDelete: 'CASCADE',
});

RefreshToken.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user',
});

module.exports = { sequelize, User, RefreshToken };
