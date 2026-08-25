/**
 * Category Validation Schemas — Catalog Service
 *
 * Joi schemas for category CRUD operations. Validates request bodies
 * before they reach the route handler, keeping handlers clean and
 * ensuring consistent error responses.
 */

const Joi = require('joi');

const createCategorySchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(100)
        .required()
        .messages({
            'string.empty': 'Category name is required.',
            'string.max': 'Category name cannot exceed 100 characters.',
            'any.required': 'Category name is required.',
        }),
    description: Joi.string()
        .trim()
        .max(500)
        .allow('')
        .default('')
        .messages({
            'string.max': 'Description cannot exceed 500 characters.',
        }),
    parentCategory: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .allow(null)
        .default(null)
        .messages({
            'string.pattern.base': 'parentCategory must be a valid MongoDB ObjectId.',
        }),
    isActive: Joi.boolean().default(true),
});

const updateCategorySchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(100)
        .messages({
            'string.empty': 'Category name cannot be empty.',
            'string.max': 'Category name cannot exceed 100 characters.',
        }),
    description: Joi.string()
        .trim()
        .max(500)
        .allow('')
        .messages({
            'string.max': 'Description cannot exceed 500 characters.',
        }),
    parentCategory: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .allow(null)
        .messages({
            'string.pattern.base': 'parentCategory must be a valid MongoDB ObjectId.',
        }),
    isActive: Joi.boolean(),
}).min(1).messages({
    'object.min': 'At least one field must be provided for update.',
});

module.exports = {
    createCategorySchema,
    updateCategorySchema,
};
