/**
 * Models Index — Inventory Service
 *
 * Imports all models, sets up associations, and re-exports everything.
 */

const sequelize = require('../config/database');
const Inventory = require('./Inventory');
const Reservation = require('./Reservation');

// No direct FK association between Inventory and Reservation
// because they're linked by productId (string), not a standard FK.
// Lookups are done via queries, not Sequelize associations.

module.exports = { sequelize, Inventory, Reservation };
