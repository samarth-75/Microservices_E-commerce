/**
 * Authentication Middleware — Catalog Service
 *
 * Lightweight JWT verification using the same access token secret as
 * auth-service. Each service independently validates tokens — no
 * service-to-service call needed for auth.
 *
 * Why duplicate this instead of a shared library?
 *   - Each service is independently deployable with its own node_modules.
 *   - Shared libraries create coupling and versioning headaches.
 *   - This is 30 lines of code — the cost of duplication is near zero.
 *   - In production, you'd use a shared npm package published to a
 *     private registry, or move token validation into the API Gateway.
 */

const jwt = require('jsonwebtoken');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production';

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
        req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
        next();
    } catch (err) {
        const message = err.name === 'TokenExpiredError'
            ? 'Access token has expired. Use /refresh to get a new one.'
            : 'Invalid access token.';

        return res.status(401).json({ error: 'Unauthorized', message });
    }
}

module.exports = authenticate;
