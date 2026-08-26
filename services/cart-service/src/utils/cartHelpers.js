/**
 * Cart Helpers — Cart Service
 *
 * Redis cart operations using the Hash data structure.
 *
 * Data model in Redis:
 *   Key:   cart:user:<userId> or cart:guest:<guestId>
 *   Type:  Hash
 *   Field: <productId>
 *   Value: JSON string of { productId, name, price, quantity, image, addedAt }
 *
 * Why Redis Hashes instead of a simple JSON string?
 *   - O(1) access to individual items (HGET/HSET/HDEL by productId)
 *   - No need to deserialize the entire cart to update one item
 *   - Atomic per-field operations
 *   - HGETALL to retrieve the full cart when needed
 *
 * Interview comparison:
 *   - A JSON string in a Redis STRING key would require GET → parse → modify
 *     → serialize → SET for every operation — race condition risk without locking
 *   - Hashes give us per-item atomicity for free
 */

const redis = require('../config/redis');

/**
 * Get the full cart with calculated totals.
 */
async function getCart(cartKey) {
    const raw = await redis.hgetall(cartKey);

    if (!raw || Object.keys(raw).length === 0) {
        return {
            items: [],
            summary: { totalItems: 0, totalQuantity: 0, totalPrice: 0 },
        };
    }

    const items = Object.values(raw).map((json) => {
        const item = JSON.parse(json);
        item.subtotal = parseFloat((item.price * item.quantity).toFixed(2));
        return item;
    });

    const summary = {
        totalItems: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        totalPrice: parseFloat(items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)),
    };

    return { items, summary };
}

/**
 * Add or update an item in the cart.
 * If the product already exists, increments the quantity.
 */
async function addItem(cartKey, productId, itemData, ttl) {
    const existing = await redis.hget(cartKey, productId);

    let item;
    if (existing) {
        item = JSON.parse(existing);
        item.quantity += itemData.quantity;
        // Update price/name/image to latest snapshot
        item.name = itemData.name;
        item.price = itemData.price;
        item.image = itemData.image;
    } else {
        item = {
            productId,
            name: itemData.name,
            price: itemData.price,
            quantity: itemData.quantity,
            image: itemData.image,
            addedAt: new Date().toISOString(),
        };
    }

    await redis.hset(cartKey, productId, JSON.stringify(item));
    await redis.expire(cartKey, ttl);

    return item;
}

/**
 * Update the quantity of an existing item.
 * If quantity is 0, removes the item.
 */
async function updateQuantity(cartKey, productId, quantity, ttl) {
    if (quantity <= 0) {
        return removeItem(cartKey, productId);
    }

    const existing = await redis.hget(cartKey, productId);
    if (!existing) {
        return null;
    }

    const item = JSON.parse(existing);
    item.quantity = quantity;

    await redis.hset(cartKey, productId, JSON.stringify(item));
    await redis.expire(cartKey, ttl);

    return item;
}

/**
 * Remove a single item from the cart.
 */
async function removeItem(cartKey, productId) {
    const removed = await redis.hdel(cartKey, productId);
    return removed > 0;
}

/**
 * Clear the entire cart.
 */
async function clearCart(cartKey) {
    await redis.del(cartKey);
}

/**
 * Merge a guest cart into a user cart.
 *
 * Strategy: user cart items take precedence for the same product.
 * Guest-only items are added to the user cart. After merge, the
 * guest cart is deleted.
 *
 * Why user items take precedence?
 *   - The user explicitly added those items while logged in
 *   - Guest items were added before the user identified themselves
 *   - In case of conflict (same product, different quantity), the user's
 *     explicit choice is more intentional
 */
async function mergeCarts(guestKey, userKey, userTTL) {
    const guestRaw = await redis.hgetall(guestKey);

    if (!guestRaw || Object.keys(guestRaw).length === 0) {
        return { merged: 0 };
    }

    const userRaw = await redis.hgetall(userKey);
    let mergedCount = 0;

    for (const [productId, guestJson] of Object.entries(guestRaw)) {
        if (!userRaw || !userRaw[productId]) {
            // Guest-only item → add to user cart
            await redis.hset(userKey, productId, guestJson);
            mergedCount++;
        }
        // If user already has this product, keep user's version (precedence)
    }

    // Set TTL on user cart and delete guest cart
    await redis.expire(userKey, userTTL);
    await redis.del(guestKey);

    return { merged: mergedCount };
}

module.exports = {
    getCart,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    mergeCarts,
};
