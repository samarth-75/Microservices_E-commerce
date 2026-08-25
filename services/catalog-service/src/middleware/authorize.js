/**
 * Authorization Middleware Factory — Catalog Service
 *
 * Checks that the authenticated user has one of the required roles.
 * Must be used AFTER the authenticate middleware (which sets req.user).
 *
 * Usage:
 *   router.post('/', authenticate, authorize('admin'), handler);
 *   router.get('/admin-or-manager', authenticate, authorize('admin', 'manager'), handler);
 */

function authorize(...allowedRoles) {
    return (req, res, next) => {
        // authenticate middleware must have run first
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required before authorization check.',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${req.user.role}.`,
            });
        }

        next();
    };
}

module.exports = authorize;
