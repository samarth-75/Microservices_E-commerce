/**
 * Product Routes — Catalog Service
 *
 * CRUD endpoints for products with pagination, filtering, search,
 * image upload, and Redis cache-aside.
 *
 * Public routes:
 *   GET /              — list products (paginated, filtered, sorted, searchable, cached)
 *   GET /:id           — get product by ID (cached)
 *
 * Admin-only routes:
 *   POST /             — create product (with image upload)
 *   PUT /:id           — update product (with optional image upload)
 *   DELETE /:id        — soft-delete (set isActive: false)
 *
 * Cache strategy:
 *   - Product list: 5 min TTL, keyed by query hash
 *   - Product detail: 30 min TTL, keyed by product ID
 *   - On any write, invalidate the specific detail cache AND all list caches
 *     (because we can't predict which list queries include the modified product)
 */

const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { upload, handleMulterError } = require('../middleware/upload');
const {
    createProductSchema,
    updateProductSchema,
    getProductsQuerySchema,
} = require('../validations/product.validation');
const {
    TTL, KEYS,
    hashQuery, getFromCache, setCache,
    invalidateCacheByKeys, invalidateCacheByPattern,
} = require('../utils/cache');

// -----------------------------------------------------------------------
// GET / — List products with pagination, filtering, sorting, and search
// -----------------------------------------------------------------------
router.get('/', validate(getProductsQuerySchema, 'query'), async (req, res, next) => {
    try {
        const {
            page, limit, category, minPrice, maxPrice,
            brand, search, sort, isActive, tags,
        } = req.query;

        // 1. Check cache
        const cacheKey = `${KEYS.PRODUCT_LIST}${hashQuery(req.query)}`;
        const cached = await getFromCache(cacheKey);
        if (cached) {
            return res.json({ ...cached, source: 'cache' });
        }

        // 2. Build MongoDB filter
        const filter = {};

        // Default: only show active products for public queries
        filter.isActive = isActive !== undefined ? isActive : true;

        if (category) {
            filter.category = category;
        }

        if (minPrice !== undefined || maxPrice !== undefined) {
            filter.price = {};
            if (minPrice !== undefined) filter.price.$gte = minPrice;
            if (maxPrice !== undefined) filter.price.$lte = maxPrice;
        }

        if (brand) {
            filter.brand = new RegExp(`^${brand}$`, 'i'); // case-insensitive exact match
        }

        if (tags) {
            const tagArray = Array.isArray(tags) ? tags : [tags];
            filter.tags = { $in: tagArray };
        }

        // Full-text search using MongoDB text index
        if (search) {
            filter.$text = { $search: search };
        }

        // 3. Build sort
        const sortOptions = {
            price_asc: { price: 1 },
            price_desc: { price: -1 },
            newest: { createdAt: -1 },
            oldest: { createdAt: 1 },
            name_asc: { name: 1 },
            name_desc: { name: -1 },
        };

        let sortObj = sortOptions[sort] || sortOptions.newest;

        // If searching, add text score sort for relevance ranking
        if (search) {
            sortObj = { score: { $meta: 'textScore' }, ...sortObj };
        }

        // 4. Execute query with pagination
        const skip = (page - 1) * limit;

        let query = Product.find(filter);

        // Add text score projection for search queries
        if (search) {
            query = query.select({ score: { $meta: 'textScore' } });
        }

        const [products, total] = await Promise.all([
            query
                .populate('category', 'name slug')
                .sort(sortObj)
                .skip(skip)
                .limit(limit)
                .lean(),
            Product.countDocuments(filter),
        ]);

        const response = {
            products,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };

        // 5. Write to cache
        await setCache(cacheKey, response, TTL.PRODUCT_LIST);

        res.json({ ...response, source: 'db' });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// GET /:id — Get product by ID
// -----------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid product ID format.',
            });
        }

        // 1. Check cache
        const cacheKey = `${KEYS.PRODUCT_DETAIL}${id}`;
        const cached = await getFromCache(cacheKey);
        if (cached) {
            return res.json({ ...cached, source: 'cache' });
        }

        // 2. Cache miss → fetch from MongoDB
        const product = await Product.findById(id)
            .populate('category', 'name slug')
            .lean();

        if (!product) {
            return res.status(404).json({
                error: 'Not Found',
                message: `Product with ID ${id} not found.`,
            });
        }

        // 3. Write to cache
        await setCache(cacheKey, { product }, TTL.PRODUCT_DETAIL);

        res.json({ product, source: 'db' });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// POST / — Create product (admin only, with image upload)
// -----------------------------------------------------------------------
router.post(
    '/',
    authenticate,
    authorize('admin'),
    upload.array('images', 5),
    handleMulterError,
    validate(createProductSchema),
    async (req, res, next) => {
        try {
            // Validate that the category exists
            const categoryExists = await Category.findById(req.body.category);
            if (!categoryExists) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Category ${req.body.category} does not exist.`,
                });
            }

            // Handle tags if sent as a comma-separated string
            if (typeof req.body.tags === 'string') {
                req.body.tags = req.body.tags.split(',').map((t) => t.trim()).filter(Boolean);
            }

            // Handle attributes if sent as a JSON string (from multipart form)
            if (typeof req.body.attributes === 'string') {
                try {
                    req.body.attributes = JSON.parse(req.body.attributes);
                } catch {
                    req.body.attributes = {};
                }
            }

            // Collect uploaded file paths
            const images = req.files
                ? req.files.map((file) => `/uploads/products/${file.filename}`)
                : [];

            const product = new Product({
                ...req.body,
                images,
            });

            await product.save();

            // Populate category for response
            await product.populate('category', 'name slug');

            // Invalidate product list caches (can't predict which lists include this product)
            await invalidateCacheByPattern(`${KEYS.PRODUCT_LIST}*`);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: 'Product created',
                productId: product._id,
                sku: product.sku,
                requestId: req.id,
            }));

            res.status(201).json({ product });
        } catch (err) {
            // Handle duplicate SKU
            if (err.code === 11000) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'A product with this SKU already exists.',
                });
            }
            next(err);
        }
    }
);

// -----------------------------------------------------------------------
// PUT /:id — Update product (admin only, with optional image upload)
// -----------------------------------------------------------------------
router.put(
    '/:id',
    authenticate,
    authorize('admin'),
    upload.array('images', 5),
    handleMulterError,
    validate(updateProductSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            if (!id.match(/^[0-9a-fA-F]{24}$/)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid product ID format.',
                });
            }

            // Validate category if being updated
            if (req.body.category) {
                const categoryExists = await Category.findById(req.body.category);
                if (!categoryExists) {
                    return res.status(400).json({
                        error: 'Validation Error',
                        message: `Category ${req.body.category} does not exist.`,
                    });
                }
            }

            const product = await Product.findById(id);
            if (!product) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Product with ID ${id} not found.`,
                });
            }

            // Handle tags if sent as a comma-separated string
            if (typeof req.body.tags === 'string') {
                req.body.tags = req.body.tags.split(',').map((t) => t.trim()).filter(Boolean);
            }

            // Handle attributes if sent as a JSON string (from multipart form)
            if (typeof req.body.attributes === 'string') {
                try {
                    req.body.attributes = JSON.parse(req.body.attributes);
                } catch {
                    req.body.attributes = {};
                }
            }

            // Append new uploaded images to existing ones
            if (req.files && req.files.length > 0) {
                const newImages = req.files.map((file) => `/uploads/products/${file.filename}`);
                product.images = [...product.images, ...newImages];
            }

            // Apply body updates
            Object.assign(product, req.body);
            await product.save();

            // Populate category for response
            await product.populate('category', 'name slug');

            // Invalidate both detail and list caches
            await invalidateCacheByKeys(`${KEYS.PRODUCT_DETAIL}${id}`);
            await invalidateCacheByPattern(`${KEYS.PRODUCT_LIST}*`);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: 'Product updated',
                productId: id,
                requestId: req.id,
            }));

            res.json({ product });
        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'A product with this SKU already exists.',
                });
            }
            next(err);
        }
    }
);

// -----------------------------------------------------------------------
// DELETE /:id — Soft-delete product (admin only)
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
                    message: 'Invalid product ID format.',
                });
            }

            const product = await Product.findById(id);
            if (!product) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Product with ID ${id} not found.`,
                });
            }

            // Soft delete
            product.isActive = false;
            await product.save();

            // Invalidate caches
            await invalidateCacheByKeys(`${KEYS.PRODUCT_DETAIL}${id}`);
            await invalidateCacheByPattern(`${KEYS.PRODUCT_LIST}*`);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'catalog-service',
                message: 'Product soft-deleted',
                productId: id,
                sku: product.sku,
                requestId: req.id,
            }));

            res.json({ message: 'Product deleted successfully.', productId: id });
        } catch (err) {
            next(err);
        }
    }
);

module.exports = router;
