/**
 * CommerceSphere Catalog Service — Mongoose Database Configuration
 *
 * Creates and exports a function to connect to MongoDB.
 * Connection URI comes from the MONGO_URI environment variable so the same
 * code works in local dev and inside Docker without changes.
 *
 * Why Mongoose over the raw MongoDB driver?
 *   - Schema validation at the application layer (defense in depth with Joi)
 *   - Middleware hooks (pre-save, post-remove) for cache invalidation
 *   - Population (join-like) for category references on products
 *   - Easier to explain in an interview than raw aggregation pipelines
 */

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/commercesphere_catalog';

async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'catalog-service',
            message: 'MongoDB connection established successfully.',
        }));
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'fatal',
            service: 'catalog-service',
            message: 'Failed to connect to MongoDB',
            error: err.message,
        }));
        throw err;
    }
}

// Log connection events for observability
mongoose.connection.on('disconnected', () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'catalog-service',
        message: 'MongoDB disconnected. Attempting reconnect...',
    }));
});

mongoose.connection.on('error', (err) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'catalog-service',
        message: 'MongoDB connection error',
        error: err.message,
    }));
});

module.exports = { connectMongo, mongoose };
