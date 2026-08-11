/**
 * Joi Validation Schemas — Auth Service
 *
 * Defines the shape and constraints for all auth endpoint request bodies.
 * Used with the validate() middleware factory.
 *
 * Password rules (interview-friendly):
 *   - Minimum 8 characters
 *   - At least one uppercase, one lowercase, one digit, one special char
 *   - These limits are strict enough for demo/interview but not so strict
 *     they annoy testers. In production, consider NIST 800-63B guidelines
 *     (min length, check against breached lists, no composition rules).
 */

const Joi = require('joi');

// Reusable password pattern — at least 8 chars, 1 upper, 1 lower, 1 digit, 1 special
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const passwordMessage =
    'Password must be at least 8 characters with at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&).';

const signupSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Must be a valid email address.',
        'any.required': 'Email is required.',
    }),
    password: Joi.string().pattern(passwordPattern).required().messages({
        'string.pattern.base': passwordMessage,
        'any.required': 'Password is required.',
    }),
    firstName: Joi.string().min(1).max(100).required().messages({
        'any.required': 'First name is required.',
        'string.max': 'First name must be 100 characters or fewer.',
    }),
    lastName: Joi.string().min(1).max(100).required().messages({
        'any.required': 'Last name is required.',
        'string.max': 'Last name must be 100 characters or fewer.',
    }),
    role: Joi.string().valid('admin', 'customer').default('customer').messages({
        'any.only': 'Role must be either "admin" or "customer".',
    }),
});

const loginSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Must be a valid email address.',
        'any.required': 'Email is required.',
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required.',
    }),
});

const refreshSchema = Joi.object({
    refreshToken: Joi.string().required().messages({
        'any.required': 'Refresh token is required.',
    }),
});

module.exports = { signupSchema, loginSchema, refreshSchema };
