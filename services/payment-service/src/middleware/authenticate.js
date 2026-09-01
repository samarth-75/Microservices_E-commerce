/**
 * Authentication Middleware — Payment Service
 *
 * Independent JWT verification — each service validates tokens
 * independently per the database-per-service design decision.
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
