/**
 * CommerceSphere Analytics Service — Auth Middleware
 *
 * Verifies JWT access tokens. Same pattern as all other services — each
 * service validates tokens independently (no shared library).
 */

const jwt = require('jsonwebtoken');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production';

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Missing or invalid Authorization header.',
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired access token.',
        });
    }
}

module.exports = authenticate;
