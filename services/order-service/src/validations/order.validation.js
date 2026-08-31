/**
 * Order Validation Schemas — Order Service
 *
 * Joi schemas for input validation on all order endpoints.
 * Applied as middleware before route handlers.
 */

const Joi = require('joi');

/**
 * POST / — Create order
 * Requires a shipping address. Notes are optional.
 * Cart items come from the cart service, not from the request body.
 */
const createOrderSchema = Joi.object({
    shippingAddress: Joi.object({
        street: Joi.string().trim().min(1).max(255).required(),
        city: Joi.string().trim().min(1).max(100).required(),
        state: Joi.string().trim().min(1).max(100).required(),
        zip: Joi.string().trim().min(1).max(20).required(),
        country: Joi.string().trim().min(1).max(100).required(),
    }).required(),
    notes: Joi.string().trim().max(500).allow('', null),
});

/**
 * PUT /:id/status — Admin update order status
 * Only allows valid status values. Transition logic is in the route handler.
 */
const updateStatusSchema = Joi.object({
    status: Joi.string()
        .valid('PENDING', 'CONFIRMED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED')
        .required(),
});

/**
 * GET / — List orders (query params)
 */
const listOrdersSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
    status: Joi.string().valid('PENDING', 'CONFIRMED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'),
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
    createOrderSchema,
    updateStatusSchema,
    listOrdersSchema,
    validate,
};
