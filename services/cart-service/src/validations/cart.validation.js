/**
 * Cart Validation Schemas — Cart Service
 *
 * Joi schemas for cart operations.
 */

const Joi = require('joi');

const addItemSchema = Joi.object({
    productId: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
            'string.pattern.base': 'productId must be a valid MongoDB ObjectId.',
            'any.required': 'productId is required.',
        }),
    quantity: Joi.number()
        .integer()
        .min(1)
        .max(99)
        .default(1)
        .messages({
            'number.min': 'Quantity must be at least 1.',
            'number.max': 'Quantity cannot exceed 99.',
        }),
});

const updateQuantitySchema = Joi.object({
    quantity: Joi.number()
        .integer()
        .min(0)
        .max(99)
        .required()
        .messages({
            'number.min': 'Quantity must be 0 (to remove) or greater.',
            'number.max': 'Quantity cannot exceed 99.',
            'any.required': 'Quantity is required.',
        }),
});

const mergeCartSchema = Joi.object({
    guestId: Joi.string()
        .trim()
        .min(1)
        .required()
        .messages({
            'string.empty': 'guestId is required.',
            'any.required': 'guestId is required for cart merge.',
        }),
});

module.exports = {
    addItemSchema,
    updateQuantitySchema,
    mergeCartSchema,
};
