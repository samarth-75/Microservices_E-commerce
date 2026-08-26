# Cart Service — Documentation

## Overview

The Cart Service manages shopping carts for CommerceSphere. It handles adding,
removing, and updating items for both guest and authenticated users, with a merge
flow when guests log in.

**Key architectural distinction:** Redis is the **primary data store** here, not a cache.
- **Catalog Service:** Redis = cache, MongoDB = source of truth
- **Cart Service:** Redis = source of truth, no backing database

This is intentional. Carts are ephemeral, session-scoped data with a natural expiry.
A lost cart is annoying, not catastrophic (unlike a lost order). Redis provides
sub-millisecond latency for the high-frequency add/remove operations.

## Architecture

```
Client → API Gateway (/api/cart/*) → Cart Service (port 3003)
                                         ├── Redis (primary store)
                                         └── REST → Catalog Service (product validation)
```

### Cross-Service Communication

When a user adds an item to their cart, the cart service validates the product
by making a **synchronous REST call** to the Catalog Service:

```
POST /cart/items { productId: "abc", quantity: 2 }
    → Cart Service → GET http://catalog-service:3002/catalog/products/abc
                                → Catalog Service → MongoDB (or Redis cache)
    ← { product: { name, price, images, isActive } }
    → Snapshot name/price/image into cart item
    → HSET cart:user:123 abc '{"name":"...","price":79.99,...}'
```

**Why REST and not shared DB?** Database-per-service pattern. Cart never touches
MongoDB. The catalog service OWNS product data — we ask it, not its database.

## Data Model

### Redis Key Pattern

```
cart:user:<userId>     → authenticated user cart (TTL: 30 days)
cart:guest:<guestId>   → guest cart (TTL: 7 days)
```

### Redis Data Structure: Hash

Each cart is a Redis Hash where:
- **Key:** `cart:user:<userId>` or `cart:guest:<guestId>`
- **Field:** `<productId>` (MongoDB ObjectId from catalog)
- **Value:** JSON string of the cart item

**Why Hashes over a single JSON string?**
- O(1) access to individual items (`HGET`/`HSET`/`HDEL` by productId)
- No need to deserialize the entire cart to update one item
- Atomic per-field operations (no race conditions)
- `HGETALL` retrieves the full cart when needed

**Alternative (JSON in a STRING key):**
- Would require `GET → parse → modify → serialize → SET` for every operation
- Race condition risk without locking when concurrent requests modify the cart
- Simple to implement but doesn't scale

### Cart Item Structure

```json
{
    "productId": "6a8dc022...",
    "name": "Wireless Bluetooth Headphones",
    "price": 79.99,
    "quantity": 2,
    "image": "/uploads/products/abc.jpg",
    "addedAt": "2026-08-26T..."
}
```

The `name`, `price`, and `image` are **snapshots** from the catalog at add-time. The
order service will re-validate prices at checkout.

## Identity Resolution

### How the Cart Identifies Users

```
Request arrives
    │
    ├─ Has valid JWT? → cart:user:<userId> (30-day TTL)
    │
    ├─ Has x-guest-id header? → cart:guest:<guestId> (7-day TTL)
    │
    └─ Neither? → 400 Bad Request
```

The `resolveCartId` middleware centralizes this logic. Authenticated users always
take priority over guest IDs (if both headers are present, the JWT wins).

### Guest Cart Flow

1. Frontend generates a UUID (`guestId`) and stores it in localStorage
2. All cart requests include `x-guest-id: <guestId>` header
3. Cart data expires after 7 days of inactivity (TTL refreshed on every operation)

### Cart Merge on Login

```
1. Guest browses → adds items (cart:guest:<guestId>)
2. Guest logs in → frontend gets JWT
3. Frontend calls POST /cart/merge { guestId: "<guestId>" }
4. Cart service:
     a. HGETALL cart:guest:<guestId>
     b. HGETALL cart:user:<userId>
     c. For each guest item:
          - If user doesn't have this product → add it
          - If user already has this product → keep user's version
     d. EXPIRE cart:user:<userId> 2592000
     e. DEL cart:guest:<guestId>
5. Return merged user cart
```

**Conflict resolution:** User items take precedence. The user explicitly added
those items while logged in; guest items were added before identification.

## API Reference

### Get Cart
```
GET /api/cart
Headers: Authorization: Bearer <token> OR x-guest-id: <uuid>
```

**Response:**
```json
{
    "cartId": "user:abc123",
    "items": [
        {
            "productId": "6a8dc022...",
            "name": "Wireless Headphones",
            "price": 79.99,
            "quantity": 2,
            "image": "/uploads/products/abc.jpg",
            "addedAt": "2026-08-26T...",
            "subtotal": 159.98
        }
    ],
    "summary": {
        "totalItems": 1,
        "totalQuantity": 2,
        "totalPrice": 159.98
    }
}
```

### Add Item
```
POST /api/cart/items
Headers: Authorization: Bearer <token> OR x-guest-id: <uuid>
Content-Type: application/json

{ "productId": "6a8dc022...", "quantity": 2 }
```

Validates product via Catalog Service REST call. Returns 404 if product not found.

### Update Quantity
```
PUT /api/cart/items/:productId
Headers: Authorization: Bearer <token> OR x-guest-id: <uuid>
Content-Type: application/json

{ "quantity": 3 }
```

Setting quantity to 0 removes the item.

### Remove Item
```
DELETE /api/cart/items/:productId
Headers: Authorization: Bearer <token> OR x-guest-id: <uuid>
```

### Clear Cart
```
DELETE /api/cart
Headers: Authorization: Bearer <token> OR x-guest-id: <uuid>
```

### Merge Cart (Auth Required)
```
POST /api/cart/merge
Headers: Authorization: Bearer <token>
Content-Type: application/json

{ "guestId": "<uuid-from-localStorage>" }
```

## TTL Strategy

| Cart Type | TTL | Rationale |
|---|---|---|
| Guest cart | 7 days (604800s) | Guests may not return — auto-cleanup for abandoned carts |
| User cart | 30 days (2592000s) | Users are more likely to return; longer persistence |

TTL is refreshed on every cart operation (add, update, remove). This means
an active cart never expires — only abandoned carts do.

## What Production Would Change

| Dev implementation | Production version |
|---|---|
| Single Redis instance | Redis Cluster with replicas |
| No persistence guarantee | Redis AOF/RDB persistence for recovery |
| HTTP REST for product validation | Could add local product cache in cart service |
| x-guest-id in header | Could use signed cookies for guest identity |
| No cart size limits | Max items per cart, max quantity per item |
| No price re-validation | Background job to re-validate prices periodically |
