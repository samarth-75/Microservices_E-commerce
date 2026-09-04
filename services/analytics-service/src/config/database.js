/**
 * CommerceSphere Analytics Service — Database Configuration
 *
 * Sequelize instance connecting to the analytics-specific PostgreSQL database.
 * Follows the same pattern as order-service and payment-service.
 */

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME || 'commercesphere_analytics',
    process.env.DB_USER || 'commercesphere',
    process.env.DB_PASSWORD || 'changeme_pg',
    {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        dialect: 'postgres',
        logging: false,
        pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000,
        },
    }
);

module.exports = sequelize;
