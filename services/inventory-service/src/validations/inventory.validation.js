/**
 * Inventory Validation Schemas — Inventory Service
 *
 * Joi schemas for input validation on all inventory endpoints.
 */

const Joi = require('joi');

/**
 * POST / — Create/set stock for a product
 */
const createStockSchema = Joi.object({
    productId: Joi.string().trim().min(1).required(),
    totalStock: Joi.number().integer().min(0).required(),
    lowStockThreshold: Joi.number().integer().min(0).default(10),
});

/**
 * PUT /:productId — Update stock level
 */
const updateStockSchema = Joi.object({
    totalStock: Joi.number().integer().min(0),
    lowStockThreshold: Joi.number().integer().min(0),
}).min(1); // at least one field required

/**
 * GET / — List inventory (query params)
 */
const listInventorySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    lowStock: Joi.boolean(), // filter for items below threshold
});

/**
 * Middleware factory — validates req.body or req.query against a Joi schema.
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], {
            abortEarly: false,
            stripUnknown: true,
        });

        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details.map((d) => d.message),
            });
        }

        req[source] = value;
        next();
    };
}

module.exports = {
    createStockSchema,
    updateStockSchema,
    listInventorySchema,
    validate,
};
