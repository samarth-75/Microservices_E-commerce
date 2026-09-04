/**
 * CommerceSphere Analytics Service — Authorization Middleware
 *
 * Role-based access control. Analytics endpoints are admin-only.
 */

function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have permission to access this resource.',
            });
        }
        next();
    };
}

module.exports = authorize;
