/**
 * CommerceSphere Analytics Service — Routes
 *
 * Admin-only REST endpoints for querying sales metrics.
 * All data comes from the analytics DB (populated by RabbitMQ consumers),
 * never from querying other services' databases.
 *
 * Endpoints:
 *   GET /analytics/orders/summary   — total orders, revenue, avg order value
 *   GET /analytics/orders/daily     — orders per day for last N days
 *   GET /analytics/products/top     — top N products by quantity sold
 */

const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { OrderEvent, OrderItemEvent } = require('../models');

const router = express.Router();

// All analytics routes require admin auth
router.use(authenticate);
router.use(authorize('admin'));

// -----------------------------------------------------------------------
// GET /analytics/orders/summary
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD (optional date range)
// -----------------------------------------------------------------------
router.get('/orders/summary', async (req, res) => {
    try {
        const where = { status: 'CREATED' }; // Exclude cancelled orders

        // Optional date filtering
        if (req.query.from || req.query.to) {
            where.orderDate = {};
            if (req.query.from) {
                where.orderDate[Op.gte] = new Date(req.query.from);
            }
            if (req.query.to) {
                // Include the entire "to" day
                const toDate = new Date(req.query.to);
                toDate.setHours(23, 59, 59, 999);
                where.orderDate[Op.lte] = toDate;
            }
        }

        const totalOrders = await OrderEvent.count({ where });

        const revenueResult = await OrderEvent.findOne({
            where,
            attributes: [
                [fn('COALESCE', fn('SUM', col('totalAmount')), 0), 'totalRevenue'],
            ],
            raw: true,
        });

        const totalRevenue = parseFloat(revenueResult.totalRevenue) || 0;
        const avgOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0;

        const cancelledOrders = await OrderEvent.count({
            where: {
                status: 'CANCELLED',
                ...(where.orderDate ? { orderDate: where.orderDate } : {}),
            },
        });

        res.json({
            totalOrders,
            cancelledOrders,
            totalRevenue: totalRevenue.toFixed(2),
            averageOrderValue: parseFloat(avgOrderValue),
            dateRange: {
                from: req.query.from || 'all-time',
                to: req.query.to || 'now',
            },
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            requestId: req.id,
            message: 'Failed to fetch order summary',
            error: err.message,
        }));

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch order summary.',
        });
    }
});

// -----------------------------------------------------------------------
// GET /analytics/orders/daily
// Query params: ?days=30 (default: 30)
// -----------------------------------------------------------------------
router.get('/orders/daily', async (req, res) => {
    try {
        const days = parseInt(req.query.days, 10) || 30;
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);

        const dailyOrders = await OrderEvent.findAll({
            where: {
                status: 'CREATED',
                orderDate: { [Op.gte]: fromDate },
            },
            attributes: [
                [fn('DATE', col('orderDate')), 'date'],
                [fn('COUNT', col('id')), 'orderCount'],
                [fn('COALESCE', fn('SUM', col('totalAmount')), 0), 'revenue'],
            ],
            group: [fn('DATE', col('orderDate'))],
            order: [[fn('DATE', col('orderDate')), 'ASC']],
            raw: true,
        });

        res.json({
            days,
            from: fromDate.toISOString().split('T')[0],
            to: new Date().toISOString().split('T')[0],
            data: dailyOrders.map((d) => ({
                date: d.date,
                orderCount: parseInt(d.orderCount, 10),
                revenue: parseFloat(d.revenue).toFixed(2),
            })),
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            requestId: req.id,
            message: 'Failed to fetch daily orders',
            error: err.message,
        }));

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch daily orders.',
        });
    }
});

// -----------------------------------------------------------------------
// GET /analytics/products/top
// Query params: ?limit=10&days=30 (defaults: 10 products, last 30 days)
// -----------------------------------------------------------------------
router.get('/products/top', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 10;
        const days = parseInt(req.query.days, 10) || 30;
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);

        const topProducts = await OrderItemEvent.findAll({
            attributes: [
                'productId',
                'productName',
                [fn('SUM', col('quantity')), 'totalQuantity'],
                [fn('SUM', literal('"quantity" * "price"')), 'totalRevenue'],
                [fn('COUNT', fn('DISTINCT', col('orderId'))), 'orderCount'],
            ],
            where: {
                createdAt: { [Op.gte]: fromDate },
            },
            group: ['productId', 'productName'],
            order: [[fn('SUM', col('quantity')), 'DESC']],
            limit,
            raw: true,
        });

        res.json({
            limit,
            days,
            from: fromDate.toISOString().split('T')[0],
            to: new Date().toISOString().split('T')[0],
            data: topProducts.map((p) => ({
                productId: p.productId,
                productName: p.productName,
                totalQuantity: parseInt(p.totalQuantity, 10),
                totalRevenue: parseFloat(p.totalRevenue).toFixed(2),
                orderCount: parseInt(p.orderCount, 10),
            })),
        });
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'analytics-service',
            requestId: req.id,
            message: 'Failed to fetch top products',
            error: err.message,
        }));

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch top products.',
        });
    }
});

module.exports = router;
