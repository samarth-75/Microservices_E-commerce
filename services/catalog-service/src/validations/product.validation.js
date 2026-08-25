/**
 * Product Validation Schemas — Catalog Service
 *
 * Joi schemas for product CRUD and listing query parameters.
 * Note: image upload is handled by multer middleware, not Joi —
 * Joi validates the JSON body fields, multer validates file constraints.
 */

const Joi = require('joi');

const createProductSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(200)
        .required()
        .messages({
            'string.empty': 'Product name is required.',
            'string.max': 'Product name cannot exceed 200 characters.',
            'any.required': 'Product name is required.',
        }),
    description: Joi.string()
        .trim()
        .max(2000)
        .allow('')
        .default('')
        .messages({
            'string.max': 'Description cannot exceed 2000 characters.',
        }),
    price: Joi.number()
        .min(0)
        .required()
        .messages({
            'number.min': 'Price cannot be negative.',
            'any.required': 'Price is required.',
        }),
    category: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
            'string.pattern.base': 'Category must be a valid MongoDB ObjectId.',
            'any.required': 'Category is required.',
        }),
    sku: Joi.string()
        .trim()
        .min(1)
        .max(50)
        .required()
        .messages({
            'string.empty': 'SKU is required.',
            'any.required': 'SKU is required.',
        }),
    tags: Joi.alternatives()
        .try(
            Joi.array().items(Joi.string().trim()),
            Joi.string().trim()
        )
        .default([]),
    brand: Joi.string()
        .trim()
        .max(100)
        .allow('')
        .default('')
        .messages({
            'string.max': 'Brand cannot exceed 100 characters.',
        }),
    attributes: Joi.object()
        .pattern(Joi.string(), Joi.string())
        .default({}),
    isActive: Joi.boolean().default(true),
});

const updateProductSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(1)
        .max(200)
        .messages({
            'string.empty': 'Product name cannot be empty.',
            'string.max': 'Product name cannot exceed 200 characters.',
        }),
    description: Joi.string()
        .trim()
        .max(2000)
        .allow('')
        .messages({
            'string.max': 'Description cannot exceed 2000 characters.',
        }),
    price: Joi.number()
        .min(0)
        .messages({
            'number.min': 'Price cannot be negative.',
        }),
    category: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .messages({
            'string.pattern.base': 'Category must be a valid MongoDB ObjectId.',
        }),
    sku: Joi.string()
        .trim()
        .min(1)
        .max(50)
        .messages({
            'string.empty': 'SKU cannot be empty.',
        }),
    tags: Joi.alternatives()
        .try(
            Joi.array().items(Joi.string().trim()),
            Joi.string().trim()
        ),
    brand: Joi.string()
        .trim()
        .max(100)
        .allow('')
        .messages({
            'string.max': 'Brand cannot exceed 100 characters.',
        }),
    attributes: Joi.object()
        .pattern(Joi.string(), Joi.string()),
    isActive: Joi.boolean(),
}).min(1).messages({
    'object.min': 'At least one field must be provided for update.',
});

/**
 * Query parameter validation for GET /products
 * Supports pagination, filtering, sorting, and search.
 */
const getProductsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    category: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    brand: Joi.string().trim(),
    search: Joi.string().trim().max(200),
    sort: Joi.string().valid(
        'price_asc', 'price_desc',
        'newest', 'oldest',
        'name_asc', 'name_desc'
    ).default('newest'),
    isActive: Joi.boolean(),
    tags: Joi.alternatives()
        .try(
            Joi.array().items(Joi.string().trim()),
            Joi.string().trim()
        ),
});

module.exports = {
    createProductSchema,
    updateProductSchema,
    getProductsQuerySchema,
};
