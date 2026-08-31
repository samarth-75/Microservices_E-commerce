/**
 * CommerceSphere Inventory Service — Sequelize Database Configuration
 *
 * Creates and exports a Sequelize instance connected to PostgreSQL.
 * Points to the commercesphere_inventory database.
 */

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME || 'commercesphere_inventory',
    process.env.DB_USER || 'commercesphere',
    process.env.DB_PASSWORD || 'changeme_pg',
    {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        dialect: 'postgres',

        logging: process.env.NODE_ENV === 'development'
            ? (msg) => console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'debug',
                service: 'inventory-service',
                source: 'sequelize',
                message: msg,
            }))
            : false,

        pool: {
            max: 10,
            min: 2,
            acquire: 30000,
            idle: 10000,
        },
    }
);

module.exports = sequelize;
