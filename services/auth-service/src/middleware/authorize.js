/**
 * Authorization (RBAC) Middleware — Auth Service
 *
 * Factory function that returns middleware checking if the authenticated
 * user's role is in the allowed list. Must be used AFTER authenticate middleware.
 *
 * Usage:
 *   router.get('/admin-only', authenticate, authorize('admin'), handler);
 *   router.get('/any-user', authenticate, authorize('admin', 'customer'), handler);
 *
 * Design: simple role-based check using the ENUM stored in the User model.
 * If roles grow complex (permissions, resource-level access), replace with
 * a policy engine or permissions table — but for Admin/Customer RBAC, this
 * is explainable and sufficient.
 */

function authorize(...allowedRoles) {
    return (req, res, next) => {
        // authenticate middleware must run first to populate req.user
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required before authorization check.',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `This action requires one of the following roles: ${allowedRoles.join(', ')}. Your role: ${req.user.role}.`,
            });
        }

        next();
    };
}

module.exports = authorize;
