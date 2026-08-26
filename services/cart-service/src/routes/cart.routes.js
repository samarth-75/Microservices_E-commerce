/**
 * Cart Routes — Cart Service
 *
 * CRUD endpoints for shopping cart with guest and authenticated user support.
 *
 * All routes (except /merge) use optionalAuth + resolveCartId middleware:
 *   - If JWT is present → cart:user:<userId>
 *   - If x-guest-id header → cart:guest:<guestId>
 *   - Neither → 400
 *
 * POST /merge requires authentication (only logged-in users can merge).
 *
 * Cross-service communication:
 *   POST /items validates the product by calling Catalog Service via REST.
 *   This is the database-per-service pattern in action — cart never touches MongoDB.
 */

const express = require('express');
const router = express.Router();
const optionalAuth = require('../middleware/optionalAuth');
const authenticate = require('../middleware/authenticate');
const resolveCartId = require('../middleware/resolveCartId');
const validate = require('../middleware/validate');
const { addItemSchema, updateQuantitySchema, mergeCartSchema } = require('../validations/cart.validation');
const { getProduct } = require('../utils/catalogClient');
const {
    getCart, addItem, updateQuantity,
    removeItem, clearCart, mergeCarts,
} = require('../utils/cartHelpers');

// Apply optionalAuth + resolveCartId to all routes except /merge
const cartMiddleware = [optionalAuth, resolveCartId];

// -----------------------------------------------------------------------
// GET / — Get current cart
// -----------------------------------------------------------------------
router.get('/', ...cartMiddleware, async (req, res, next) => {
    try {
        const cart = await getCart(req.cartKey);

        res.json({
            cartId: req.cartKey.replace('cart:', ''),
            ...cart,
        });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// POST /items — Add item to cart
// -----------------------------------------------------------------------
router.post(
    '/items',
    ...cartMiddleware,
    validate(addItemSchema),
    async (req, res, next) => {
        try {
            const { productId, quantity } = req.body;

            // Cross-service validation: check product exists via Catalog Service REST call
            const product = await getProduct(productId);

            if (!product) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Product ${productId} not found or unavailable.`,
                });
            }

            if (!product.isActive) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'This product is no longer available.',
                });
            }

            // Snapshot product data into the cart item
            const itemData = {
                name: product.name,
                price: product.price,
                quantity,
                image: product.images && product.images.length > 0
                    ? product.images[0]
                    : null,
            };

            const item = await addItem(req.cartKey, productId, itemData, req.cartTTL);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'cart-service',
                message: 'Item added to cart',
                cartKey: req.cartKey,
                productId,
                quantity: item.quantity,
                requestId: req.id,
            }));

            res.status(201).json({
                message: 'Item added to cart.',
                item: { ...item, subtotal: parseFloat((item.price * item.quantity).toFixed(2)) },
            });
        } catch (err) {
            next(err);
        }
    }
);

// -----------------------------------------------------------------------
// PUT /items/:productId — Update item quantity
// -----------------------------------------------------------------------
router.put(
    '/items/:productId',
    ...cartMiddleware,
    validate(updateQuantitySchema),
    async (req, res, next) => {
        try {
            const { productId } = req.params;
            const { quantity } = req.body;

            if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid product ID format.',
                });
            }

            // Quantity 0 = remove
            if (quantity === 0) {
                const removed = await removeItem(req.cartKey, productId);
                if (!removed) {
                    return res.status(404).json({
                        error: 'Not Found',
                        message: `Product ${productId} not found in cart.`,
                    });
                }

                console.log(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    service: 'cart-service',
                    message: 'Item removed from cart (quantity set to 0)',
                    cartKey: req.cartKey,
                    productId,
                    requestId: req.id,
                }));

                return res.json({ message: 'Item removed from cart.', productId });
            }

            const item = await updateQuantity(req.cartKey, productId, quantity, req.cartTTL);

            if (!item) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Product ${productId} not found in cart.`,
                });
            }

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'cart-service',
                message: 'Cart item quantity updated',
                cartKey: req.cartKey,
                productId,
                newQuantity: quantity,
                requestId: req.id,
            }));

            res.json({
                message: 'Item quantity updated.',
                item: { ...item, subtotal: parseFloat((item.price * item.quantity).toFixed(2)) },
            });
        } catch (err) {
            next(err);
        }
    }
);

// -----------------------------------------------------------------------
// DELETE /items/:productId — Remove item from cart
// -----------------------------------------------------------------------
router.delete('/items/:productId', ...cartMiddleware, async (req, res, next) => {
    try {
        const { productId } = req.params;

        if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid product ID format.',
            });
        }

        const removed = await removeItem(req.cartKey, productId);

        if (!removed) {
            return res.status(404).json({
                error: 'Not Found',
                message: `Product ${productId} not found in cart.`,
            });
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'cart-service',
            message: 'Item removed from cart',
            cartKey: req.cartKey,
            productId,
            requestId: req.id,
        }));

        res.json({ message: 'Item removed from cart.', productId });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// DELETE / — Clear entire cart
// -----------------------------------------------------------------------
router.delete('/', ...cartMiddleware, async (req, res, next) => {
    try {
        await clearCart(req.cartKey);

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'cart-service',
            message: 'Cart cleared',
            cartKey: req.cartKey,
            requestId: req.id,
        }));

        res.json({ message: 'Cart cleared.' });
    } catch (err) {
        next(err);
    }
});

// -----------------------------------------------------------------------
// POST /merge — Merge guest cart into user cart (requires auth)
// -----------------------------------------------------------------------
router.post(
    '/merge',
    authenticate,
    validate(mergeCartSchema),
    async (req, res, next) => {
        try {
            const { guestId } = req.body;
            const userKey = `cart:user:${req.user.id}`;
            const guestKey = `cart:guest:${guestId}`;
            const userTTL = parseInt(process.env.USER_CART_TTL, 10) || 2592000;

            const result = await mergeCarts(guestKey, userKey, userTTL);

            // Return the merged user cart
            const cart = await getCart(userKey);

            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'info',
                service: 'cart-service',
                message: 'Guest cart merged into user cart',
                guestId,
                userId: req.user.id,
                itemsMerged: result.merged,
                requestId: req.id,
            }));

            res.json({
                message: `Cart merged successfully. ${result.merged} item(s) added from guest cart.`,
                cartId: `user:${req.user.id}`,
                ...cart,
            });
        } catch (err) {
            next(err);
        }
    }
);

module.exports = router;
