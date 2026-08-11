/**
 * Validation Middleware Factory — Auth Service
 *
 * Generic Joi validation middleware. Validates req.body against a given
 * Joi schema and returns structured 400 errors with field-level details.
 *
 * Usage:
 *   const { signupSchema } = require('../validations/auth.validation');
 *   router.post('/signup', validate(signupSchema), signupHandler);
 *
 * Why a factory instead of inline validation?
 *   - DRY: one validation function, many schemas.
 *   - Consistent error format across all endpoints.
 *   - Easy to test schemas in isolation.
 */

function validate(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
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

        // Replace req.body with the validated + sanitized value
        req.body = value;
        next();
    };
}

module.exports = validate;
