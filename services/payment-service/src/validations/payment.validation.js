/**
 * Payment Validation Schemas — Payment Service
 *
 * Joi schemas for input validation on all payment endpoints.
 */

const Joi = require('joi');

/**
 * POST /payments/create-session — Create Stripe Checkout Session
 */
const createSessionSchema = Joi.object({
    orderId: Joi.string().uuid().required(),
});

/**
 * POST /payments/:paymentId/refund — Initiate refund
 */
const refundSchema = Joi.object({
    reason: Joi.string().valid('duplicate', 'fraudulent', 'requested_by_customer').default('requested_by_customer'),
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
    createSessionSchema,
    refundSchema,
    validate,
};
