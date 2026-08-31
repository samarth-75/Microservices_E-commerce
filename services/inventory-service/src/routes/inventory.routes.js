/**
 * Inventory Routes — Inventory Service
 *
 * Admin-only endpoints for managing stock levels.
 * Stock reservation/release is handled by RabbitMQ consumers, not REST.
 *
 * Endpoints:
 *   POST   /              Create/set stock for a product (admin)
 *   GET    /              List all inventory (admin, paginated)
 *   GET    /:productId    Get stock level for a product (admin)
 *   PUT    /:productId    Update stock level (admin)
 */

const express = require('express');
const router = express.Router();

const { Inventory, Reservation } = require('../models');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const {
    createStockSchema,
    updateStockSchema,
    listInventorySchema,
    validate,
} = require('../validations/inventory.validation');
const { Op } = require('sequelize');

// -----------------------------------------------------------------------
// POST / — Create/set stock for a product
// -----------------------------------------------------------------------
router.post(
    '/',
    authenticate,
    authorize('admin'),
    validate(createStockSchema),
    async (req, res) => {
        try {
            const { productId, totalStock, lowStockThreshold } = req.body;

            // Check if inventory already exists for this product
            const existing = await Inventory.findOne({ where: { productId } });

            if (existing) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: `Inventory record already exists for product ${productId}. Use PUT to update.`,
                });
            }

            const inventory = await Inventory.create({
                productId,
                totalStock,
                reservedStock: 0,
                lowStockThreshold,
            });

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'inventory-service',
                requestId: req.id,
                message: 'Inventory created',
                productId,
                totalStock,
            }));

            res.status(201).json({
                message: 'Inventory record created successfully.',
                inventory: {
                    id: inventory.id,
                    productId: inventory.productId,
                    totalStock: inventory.totalStock,
                    reservedStock: inventory.reservedStock,
                    availableStock: inventory.availableStock,
                    lowStockThreshold: inventory.lowStockThreshold,
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                requestId: req.id,
                message: 'Failed to create inventory',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to create inventory record.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// GET / — List all inventory
// -----------------------------------------------------------------------
router.get(
    '/',
    authenticate,
    authorize('admin'),
    validate(listInventorySchema, 'query'),
    async (req, res) => {
        try {
            const { page, limit, lowStock } = req.query;
            const offset = (page - 1) * limit;

            const where = {};

            // Filter for items below low stock threshold
            if (lowStock === true || lowStock === 'true') {
                where[Op.and] = [
                    require('sequelize').where(
                        require('sequelize').literal('"totalStock" - "reservedStock"'),
                        '<=',
                        require('sequelize').col('lowStockThreshold')
                    ),
                ];
            }

            const { count, rows: items } = await Inventory.findAndCountAll({
                where,
                order: [['updatedAt', 'DESC']],
                limit,
                offset,
            });

            res.json({
                inventory: items.map((item) => ({
                    id: item.id,
                    productId: item.productId,
                    totalStock: item.totalStock,
                    reservedStock: item.reservedStock,
                    availableStock: item.availableStock,
                    lowStockThreshold: item.lowStockThreshold,
                    updatedAt: item.updatedAt,
                })),
                pagination: {
                    page,
                    limit,
                    totalItems: count,
                    totalPages: Math.ceil(count / limit),
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                requestId: req.id,
                message: 'Failed to list inventory',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve inventory.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// GET /:productId — Get stock level for a product
// -----------------------------------------------------------------------
router.get(
    '/:productId',
    authenticate,
    authorize('admin'),
    async (req, res) => {
        try {
            const inventory = await Inventory.findOne({
                where: { productId: req.params.productId },
            });

            if (!inventory) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `No inventory record found for product ${req.params.productId}`,
                });
            }

            // Also fetch active reservations for context
            const activeReservations = await Reservation.findAll({
                where: {
                    productId: req.params.productId,
                    status: 'ACTIVE',
                },
                order: [['createdAt', 'DESC']],
            });

            res.json({
                inventory: {
                    id: inventory.id,
                    productId: inventory.productId,
                    totalStock: inventory.totalStock,
                    reservedStock: inventory.reservedStock,
                    availableStock: inventory.availableStock,
                    lowStockThreshold: inventory.lowStockThreshold,
                    updatedAt: inventory.updatedAt,
                },
                activeReservations: activeReservations.map((r) => ({
                    id: r.id,
                    orderId: r.orderId,
                    quantity: r.quantity,
                    createdAt: r.createdAt,
                })),
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                requestId: req.id,
                message: 'Failed to get inventory',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to retrieve inventory.',
            });
        }
    }
);

// -----------------------------------------------------------------------
// PUT /:productId — Update stock level
// -----------------------------------------------------------------------
router.put(
    '/:productId',
    authenticate,
    authorize('admin'),
    validate(updateStockSchema),
    async (req, res) => {
        try {
            const inventory = await Inventory.findOne({
                where: { productId: req.params.productId },
            });

            if (!inventory) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `No inventory record found for product ${req.params.productId}`,
                });
            }

            // Update fields that were provided
            if (req.body.totalStock !== undefined) {
                // Ensure new totalStock isn't less than currently reserved
                if (req.body.totalStock < inventory.reservedStock) {
                    return res.status(400).json({
                        error: 'Invalid Stock Level',
                        message: `Cannot set totalStock to ${req.body.totalStock} — ${inventory.reservedStock} units are currently reserved.`,
                    });
                }
                inventory.totalStock = req.body.totalStock;
            }

            if (req.body.lowStockThreshold !== undefined) {
                inventory.lowStockThreshold = req.body.lowStockThreshold;
            }

            await inventory.save();

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'inventory-service',
                requestId: req.id,
                message: 'Inventory updated',
                productId: req.params.productId,
                totalStock: inventory.totalStock,
                availableStock: inventory.availableStock,
            }));

            res.json({
                message: 'Inventory updated successfully.',
                inventory: {
                    id: inventory.id,
                    productId: inventory.productId,
                    totalStock: inventory.totalStock,
                    reservedStock: inventory.reservedStock,
                    availableStock: inventory.availableStock,
                    lowStockThreshold: inventory.lowStockThreshold,
                    updatedAt: inventory.updatedAt,
                },
            });
        } catch (err) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'error',
                service: 'inventory-service',
                requestId: req.id,
                message: 'Failed to update inventory',
                error: err.message,
            }));

            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to update inventory.',
            });
        }
    }
);

module.exports = router;
