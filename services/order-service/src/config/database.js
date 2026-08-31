/**
 * CommerceSphere Order Service — Sequelize Database Configuration
 *
 * Creates and exports a Sequelize instance connected to PostgreSQL.
 * All connection params come from environment variables so the same
 * code works in local dev and inside Docker without changes.
 */

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME || 'commercesphere_orders',
    process.env.DB_USER || 'commercesphere',
    process.env.DB_PASSWORD || 'changeme_pg',
    {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        dialect: 'postgres',

        // Structured logging — log SQL only in development for debugging.
        logging: process.env.NODE_ENV === 'development'
            ? (msg) => console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'debug',
                service: 'order-service',
                source: 'sequelize',
                message: msg,
            }))
            : false,

        // Connection pool — sensible defaults for a small service.
        pool: {
            max: 10,
            min: 2,
            acquire: 30000,
            idle: 10000,
        },
    }
);

module.exports = sequelize;
