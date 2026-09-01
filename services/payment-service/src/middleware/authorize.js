/**
 * Authorization Middleware — Payment Service
 *
 * Factory function that returns middleware checking if the authenticated
 * user has the required role.
 */

function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required before authorization.',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
            });
        }

        next();
    };
}

module.exports = authorize;
