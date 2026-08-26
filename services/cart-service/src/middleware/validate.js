/**
 * Validation Middleware Factory — Cart Service
 *
 * Same Joi validation factory as catalog-service, supports body/query/params.
 */

function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            stripUnknown: true,
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

        req[source] = value;
        next();
    };
}

module.exports = validate;
