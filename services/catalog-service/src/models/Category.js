/**
 * CommerceSphere Catalog Service — Category Model
 *
 * Mongoose schema for product categories. Supports optional single-level
 * nesting via parentCategory. Slug is auto-generated from the name for
 * SEO-friendly URLs.
 *
 * Why separate categories from products?
 *   - Categories change infrequently → long cache TTL (1 hour)
 *   - Products reference categories by ObjectId → Mongoose population
 *   - Independent CRUD lifecycle (admin manages categories before adding products)
 */

const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Category name is required'],
            trim: true,
            maxlength: [100, 'Category name cannot exceed 100 characters'],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [500, 'Description cannot exceed 500 characters'],
            default: '',
        },
        slug: {
            type: String,
            unique: true,
            lowercase: true,
            index: true,
        },
        parentCategory: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

/**
 * Pre-save hook: auto-generate slug from name.
 * Replaces spaces with hyphens, removes non-alphanumeric characters,
 * and lowercases. E.g. "Electronics & Gadgets" → "electronics-gadgets"
 */
categorySchema.pre('save', function (next) {
    if (this.isModified('name')) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }
    next();
});

// Index for fast lookups by slug and active status
categorySchema.index({ slug: 1, isActive: 1 });

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
