/**
 * Category Routes — Catalog Service
 *
 * CRUD endpoints for product categories with Redis cache-aside.
 *
 * Public routes:
 *   GET /              — list all active categories (cached, 1hr TTL)
 *   GET /:id           — get category by ID (cached, 1hr TTL)
 *
 * Admin-only routes:
 *   POST /             — create category
 *   PUT /:id           — update category
 *   DELETE /:id        — soft-delete (set isActive: false)
 *
 * Cache strategy:
 *   - Categories change rarely → 1 hour TTL
 *   - On any write (create/update/delete), invalidate all category caches
 *     to ensure consistency. The cost is low because category writes are infrequent.
 */

const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { createCategorySchema, updateCategorySchema } = require('../validations/category.validation');
const {
    TTL, KEYS,
    getFromCache, setCache,
    invalidateCacheByKeys, invalidateCacheByPattern,
} = require('../utils/cache');

// -----------------------------------------------------------------------
// GET / — List all active categories
// -----------------------------------------------------------------------
router.get('/', async (req, res, next) => {
    try {
        // 1. Check cache
        const cacheKey = KEYS.CATEGORY_ALL;
        const cached = await getFromCache(cacheKey);
        if (cached) {
            return res.json({
                ...cached,
                source: 'cache',
            });
        }

        // 2. Cache miss → fetch from MongoDB
        const categories = await Category.find({ isActive: true })
            .populate('parentCategory', 'name slug')
            .sort({ name: 1 })
            .lean();

        const response = {
            categories,
            total: categories.length,
        };

        // 3. Write to cache
        await setCache(cacheKey, response, TTL.CATEGORIES);

        res.json({ ...response, source: 'db' });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// GET /:id — Get category by ID
// -----------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Validate ObjectId format
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid category ID format.',
            });
        }

        // 1. Check cache
        const cacheKey = `${KEYS.CATEGORY_DETAIL}${id}`;
        const cached = await getFromCache(cacheKey);
        if (cached) {
            return res.json({ ...cached, source: 'cache' });
        }

        // 2. Cache miss → fetch from MongoDB
        const category = await Category.findById(id)
            .populate('parentCategory', 'name slug')
            .lean();

        if (!category) {
            return res.status(404).json({
                error: 'Not Found',
                message: `Category with ID ${id} not found.`,
            });
        }

        // 3. Write to cache
        await setCache(cacheKey, { category }, TTL.CATEGORIES);

        res.json({ category, source: 'db' });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// POST / — Create category (admin only)
// -----------------------------------------------------------------------
router.post(
    '/',
    authenticate,
    authorize('admin'),
    validate(createCategorySchema),
    async (req, res, next) => {
        try {
            // Validate parent category exists if provided
            if (req.body.parentCategory) {
                const parent = await Category.findById(req.body.parentCategory);
                if (!parent) {
                    return res.status(400).json({
                        error: 'Validation Error',
                        message: `Parent category ${req.body.parentCategory} does not exist.`,
                    });
                }
            }

            const category = new Category(req.body);
            await category.save();

            // Invalidate category caches
            await invalidateCacheByKeys(KEYS.CATEGORY_ALL);
            await invalidateCacheByPattern(`${KEYS.CATEGORY_DETAIL}*`);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: 'Category created',
                categoryId: category._id,
                requestId: req.id,
            }));

            res.status(201).json({ category });
        } catch (err) {
            // Handle duplicate slug/name
            if (err.code === 11000) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'A category with this name already exists.',
                });
            }
            next(err);
        }
    }
);

// -----------------------------------------------------------------------
// PUT /:id — Update category (admin only)
// -----------------------------------------------------------------------
router.put(
    '/:id',
    authenticate,
    authorize('admin'),
    validate(updateCategorySchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            if (!id.match(/^[0-9a-fA-F]{24}$/)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid category ID format.',
                });
            }

            // Prevent self-referencing parent
            if (req.body.parentCategory === id) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'A category cannot be its own parent.',
                });
            }

            const category = await Category.findById(id);
            if (!category) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Category with ID ${id} not found.`,
                });
            }

            // Apply updates
            Object.assign(category, req.body);
            await category.save();

            // Invalidate all category caches
            await invalidateCacheByKeys(KEYS.CATEGORY_ALL, `${KEYS.CATEGORY_DETAIL}${id}`);
            await invalidateCacheByPattern(`${KEYS.CATEGORY_DETAIL}*`);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: 'Category updated',
                categoryId: id,
                requestId: req.id,
            }));

            res.json({ category });
        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'A category with this name already exists.',
                });
            }
            next(err);
        }
    }
);

// -----------------------------------------------------------------------
// DELETE /:id — Soft-delete category (admin only)
// -----------------------------------------------------------------------
router.delete(
    '/:id',
    authenticate,
    authorize('admin'),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            if (!id.match(/^[0-9a-fA-F]{24}$/)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid category ID format.',
                });
            }

            const category = await Category.findById(id);
            if (!category) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Category with ID ${id} not found.`,
                });
            }

            // Soft delete — set isActive to false
            category.isActive = false;
            await category.save();

            // Invalidate all category caches
            await invalidateCacheByKeys(KEYS.CATEGORY_ALL, `${KEYS.CATEGORY_DETAIL}${id}`);
            await invalidateCacheByPattern(`${KEYS.CATEGORY_DETAIL}*`);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: 'Category soft-deleted',
                categoryId: id,
                requestId: req.id,
            }));

            res.json({ message: 'Category deleted successfully.', categoryId: id });
        } catch (err) {
            next(err);
        }
    }
);

module.exports = router;
