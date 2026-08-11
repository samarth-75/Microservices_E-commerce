/**
 * Authentication Middleware — Auth Service
 *
 * Verifies the JWT access token from the Authorization header.
 * On success, attaches the decoded payload to req.user so downstream
 * handlers can access { id, email, role } without re-parsing.
 *
 * Usage:
 *   router.get('/me', authenticate, (req, res) => { ... });
 *
 * Token format expected: Authorization: Bearer <token>
 */

const { verifyAccessToken } = require('../utils/jwt');

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
        const decoded = verifyAccessToken(token);
        req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
        next();
    } catch (err) {
        // jwt.verify throws TokenExpiredError, JsonWebTokenError, NotBeforeError
        const message = err.name === 'TokenExpiredError'
            ? 'Access token has expired. Use /refresh to get a new one.'
            : 'Invalid access token.';

        return res.status(401).json({ error: 'Unauthorized', message });
    }
}

module.exports = authenticate;
