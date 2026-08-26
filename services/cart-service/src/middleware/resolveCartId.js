/**
 * Cart ID Resolution Middleware — Cart Service
 *
 * Determines the Redis cart key based on the request's auth state:
 *   - Authenticated user → cart:user:<userId>  (TTL: 30 days)
 *   - Guest with x-guest-id → cart:guest:<guestId> (TTL: 7 days)
 *   - Neither → 400 error
 *
 * Sets req.cartKey and req.cartTTL for downstream route handlers.
 *
 * Must be placed AFTER optionalAuth middleware in the middleware chain.
 *
 * Interview talking point:
 *   "Cart identity is resolved at the middleware layer, not in every route
 *    handler. This centralizes the guest-vs-user decision and keeps routes
 *    clean — they just use req.cartKey without caring how it was determined."
 */

// TTL in seconds
const GUEST_CART_TTL = parseInt(process.env.GUEST_CART_TTL, 10) || 604800;   // 7 days
const USER_CART_TTL = parseInt(process.env.USER_CART_TTL, 10) || 2592000;    // 30 days

function resolveCartId(req, res, next) {
    // Authenticated user takes priority
    if (req.user && req.user.id) {
        req.cartKey = `cart:user:${req.user.id}`;
        req.cartTTL = USER_CART_TTL;
        return next();
    }

    // Guest — identified by x-guest-id header (UUID generated client-side)
    const guestId = req.headers['x-guest-id'];
    if (guestId && guestId.trim()) {
        req.cartKey = `cart:guest:${guestId.trim()}`;
        req.cartTTL = GUEST_CART_TTL;
        return next();
    }

    // Neither — can't determine which cart to operate on
    return res.status(400).json({
        error: 'Bad Request',
        message: 'Cart identity required. Provide a valid Authorization header (Bearer token) or x-guest-id header.',
    });
}

module.exports = resolveCartId;
