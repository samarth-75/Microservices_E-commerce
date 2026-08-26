/**
 * Optional Authentication Middleware — Cart Service
 *
 * Tries to authenticate via JWT. If the token is present and valid,
 * sets req.user = { id, email, role }. If no token or invalid token,
 * sets req.user = null and continues WITHOUT returning 401.
 *
 * This is the key middleware for the cart service — it allows the same
 * endpoint to serve both guests (identified by x-guest-id header) and
 * authenticated users (identified by JWT).
 *
 * Interview talking point:
 *   "Most middleware is binary — authenticated or rejected. The cart needs
 *    a third state: 'not authenticated but that's okay.' optionalAuth
 *    provides that by silently setting req.user to null instead of 401-ing."
 */

const jwt = require('jsonwebtoken');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production';

function optionalAuth(req, _res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
        req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    } catch {
        // Token is present but invalid/expired — treat as guest
        req.user = null;
    }

    next();
}

module.exports = optionalAuth;
