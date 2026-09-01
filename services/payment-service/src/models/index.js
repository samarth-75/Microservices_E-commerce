/**
 * Models Index — Payment Service
 *
 * Imports all models and re-exports everything along with sequelize.
 */

const sequelize = require('../config/database');
const Payment = require('./Payment');

module.exports = { sequelize, Payment };
