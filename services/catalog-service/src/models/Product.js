/**
 * CommerceSphere Catalog Service — Product Model
 *
 * Mongoose schema for products. Uses MongoDB's flexible document model
 * to store variable attributes (e.g. size, color) as a Map — this is
 * the primary reason Catalog uses MongoDB instead of PostgreSQL.
 *
 * Interview talking point:
 *   "Products have heterogeneous attributes — a T-shirt has size and color,
 *    a laptop has RAM and storage. In PostgreSQL, you'd need an EAV table or
 *    JSONB column. MongoDB's document model handles this naturally with a Map
 *    field, and each product can have different attributes without schema changes."
 *
 * Text index on name + description enables basic full-text search via
 * MongoDB's $text operator. Good enough for this project; for typo tolerance
 * or faceted search, you'd use Elasticsearch or MongoDB Atlas Search.
 */

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Product name is required'],
            trim: true,
            maxlength: [200, 'Product name cannot exceed 200 characters'],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [2000, 'Description cannot exceed 2000 characters'],
            default: '',
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price cannot be negative'],
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            required: [true, 'Category is required'],
            index: true,
        },
        images: {
            type: [String],
            default: [],
        },
        sku: {
            type: String,
            required: [true, 'SKU is required'],
            unique: true,
            uppercase: true,
            trim: true,
            index: true,
        },
        tags: {
            type: [String],
            default: [],
            index: true,
        },
        brand: {
            type: String,
            trim: true,
            default: '',
            index: true,
        },
        attributes: {
            type: Map,
            of: String,
            default: {},
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

/**
 * Text index on name + description for full-text search.
 * Weights: name matches are ranked higher than description matches.
 *
 * Usage: Product.find({ $text: { $search: "wireless headphones" } })
 * This searches for documents containing "wireless" OR "headphones" in
 * name or description, ranked by relevance score.
 */
productSchema.index(
    { name: 'text', description: 'text' },
    { weights: { name: 10, description: 5 }, name: 'product_text_search' }
);

// Compound index for common query patterns: filter by category + sort by price
productSchema.index({ category: 1, price: 1 });
// Compound index for active products sorted by creation date
productSchema.index({ isActive: 1, createdAt: -1 });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
