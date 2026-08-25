/**
 * Validation Middleware Factory — Catalog Service
 *
 * Generic Joi validation middleware that can validate req.body, req.query,
 * or req.params. Extends the auth-service pattern to support query parameter
 * validation (needed for product filtering/pagination).
 *
 * Usage:
 *   validate(createProductSchema)              // validates req.body (default)
 *   validate(getProductsQuerySchema, 'query')  // validates req.query
 *   validate(idParamSchema, 'params')          // validates req.params
 */

function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,   // Report ALL errors, not just the first one
            stripUnknown: true,  // Remove fields not defined in the schema
        });

        if (error) {
            const details = error.details.map((detail) => ({
                field: detail.path.join('.'),
                message: detail.message,
            }));

            return res.status(400).json({
                error: 'Validation Error',
                message: 'One or more fields failed validation.',
                details,
            });
        }

        // Replace the validated source with sanitized values
        req[source] = value;
        next();
    };
}

module.exports = validate;
