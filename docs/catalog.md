# Catalog Service — Documentation

## Overview

The Catalog Service manages products, categories, and product search for CommerceSphere.
It is the first service in the platform to use MongoDB (document store) and Redis
(cache-aside), making it architecturally distinct from the Auth Service (PostgreSQL).

**Why MongoDB for the catalog?**
Products have heterogeneous attributes — a T-shirt has size and color, a laptop has
RAM and storage. In PostgreSQL, this would require either an EAV (Entity-Attribute-Value)
table (complex queries, poor performance) or a JSONB column (less schema validation).
MongoDB's document model handles this naturally with a `Map<String, String>` field on
each product — different products can have different attributes without schema migrations.

## Architecture

```
Client → API Gateway (/api/catalog/*) → Catalog Service (port 3002)
                                            ├── MongoDB (products, categories)
                                            ├── Redis (cache-aside)
                                            └── Local disk (image uploads)
```

## Data Models

### Product

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | String | ✅ | Product name, max 200 chars |
| `description` | String | | Product description, max 2000 chars |
| `price` | Number | ✅ | Price in base currency, min 0 |
| `category` | ObjectId → Category | ✅ | Reference to parent category |
| `images` | [String] | | Array of image file paths/URLs |
| `sku` | String | ✅ | Stock Keeping Unit, unique |
| `tags` | [String] | | Searchable tags |
| `brand` | String | | Brand name |
| `attributes` | Map<String, String> | | Flexible key-value attributes |
| `isActive` | Boolean | | Default: true. False = soft-deleted |
| `createdAt` | Date | | Auto-generated |
| `updatedAt` | Date | | Auto-generated |

**Indexes:**
- Text index on `name` + `description` (weights: 10/5) for full-text search
- Compound index `{ category: 1, price: 1 }` for filtered sorting
- Compound index `{ isActive: 1, createdAt: -1 }` for active product listing
- Unique index on `sku`

### Category

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | String | ✅ | Category name, max 100 chars |
| `description` | String | | Category description, max 500 chars |
| `slug` | String | | Auto-generated from name, URL-friendly |
| `parentCategory` | ObjectId → Category | | Optional parent for single-level nesting |
| `isActive` | Boolean | | Default: true. False = soft-deleted |
| `createdAt` | Date | | Auto-generated |
| `updatedAt` | Date | | Auto-generated |

**Slug generation:** Pre-save hook converts name to lowercase, removes special chars,
replaces spaces with hyphens. E.g. "Electronics & Gadgets" → "electronics-gadgets".

## API Reference

### Products

#### List Products
```
GET /api/catalog/products
```

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number (1-indexed) |
| `limit` | int | 20 | Items per page (max 100) |
| `category` | ObjectId | | Filter by category ID |
| `minPrice` | number | | Minimum price filter |
| `maxPrice` | number | | Maximum price filter |
| `brand` | string | | Filter by brand (case-insensitive) |
| `search` | string | | Full-text search on name + description |
| `sort` | string | `newest` | `price_asc`, `price_desc`, `newest`, `oldest`, `name_asc`, `name_desc` |
| `tags` | string/array | | Filter by tags (matches any) |
| `isActive` | boolean | `true` | Filter by active status |

**Response:**
```json
{
  "products": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  },
  "source": "cache" | "db"
}
```

#### Get Product
```
GET /api/catalog/products/:id
```

#### Create Product (Admin)
```
POST /api/catalog/products
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

Fields: name, description, price, category, sku, tags, brand, attributes (JSON string)
Files: images (max 5, jpeg/png/webp, max 5MB each)
```

#### Update Product (Admin)
```
PUT /api/catalog/products/:id
Authorization: Bearer <access_token>
```

#### Delete Product (Admin, soft-delete)
```
DELETE /api/catalog/products/:id
Authorization: Bearer <access_token>
```

### Categories

#### List Categories
```
GET /api/catalog/categories
```

#### Get Category
```
GET /api/catalog/categories/:id
```

#### Create Category (Admin)
```
POST /api/catalog/categories
Authorization: Bearer <access_token>
Content-Type: application/json

{ "name": "Electronics", "description": "...", "parentCategory": null }
```

#### Update Category (Admin)
```
PUT /api/catalog/categories/:id
Authorization: Bearer <access_token>
```

#### Delete Category (Admin, soft-delete)
```
DELETE /api/catalog/categories/:id
Authorization: Bearer <access_token>
```

## Search Implementation

Uses MongoDB's built-in `$text` operator with a text index on `name` and `description`.

**How it works:**
1. MongoDB tokenizes the search query into individual terms
2. Searches for documents containing ANY of the terms (OR logic)
3. Ranks results by relevance score (weighted: name 10×, description 5×)
4. Combined with other filters (category, price, etc.) using `$and`

**Limitations:**
- No typo tolerance (searching "headphon" won't match "headphones")
- No fuzzy matching
- No autocomplete/suggestions
- No faceted search

**Production upgrade path:** MongoDB Atlas Search (if staying with MongoDB) or
Elasticsearch/OpenSearch for full-featured search with typo tolerance, autocomplete,
facets, and relevance tuning.

## Image Upload

**Current implementation (dev):** Local disk storage via `multer`.
- Files stored in `uploads/products/<uuid>.<ext>`
- Served via Express static middleware at `/uploads/*`
- Max 5 images per upload, 5MB each, jpeg/png/webp only

**Production version would:**
1. Use signed URLs for direct-to-S3/Cloudinary upload (bypass the service)
2. Serve images via CDN (CloudFront, Cloudflare)
3. Generate thumbnails via a resize lambda/worker
4. Store only the CDN URL in the product document

## Authentication & Authorization

Admin routes (POST, PUT, DELETE) require a valid JWT access token with `role: 'admin'`.
The catalog service verifies tokens independently using the same `JWT_ACCESS_SECRET` as
the auth service — no service-to-service call needed.

Public routes (GET) require no authentication.
