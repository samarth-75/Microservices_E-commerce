/**
 * Catalog Client — Order Service
 *
 * HTTP client for cross-service product price validation. At checkout,
 * the order service re-validates product prices from the catalog to
 * prevent stale-price exploitation.
 *
 * Why re-validate?
 *   - Cart stores a price snapshot at add-time (for display)
 *   - But the "real" price may have changed since then
 *   - The order is for billing — it MUST use the current price
 *   - This is documented in INTERVIEW_NOTES.md (cart entry)
 */

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3002';

/**
 * Fetch a product by ID from the Catalog Service.
 * Returns the product object or null if not found / service error.
 */
async function getProduct(productId) {
    try {
        const url = `${CATALOG_SERVICE_URL}/catalog/products/${productId}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                service: 'order-service',
                message: `Catalog service returned ${response.status} for product ${productId}`,
            }));
            return null;
        }

        const data = await response.json();
        return data.product || null;
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'order-service',
            message: 'Failed to fetch product from catalog service',
            productId,
            error: err.message,
        }));
        return null;
    }
}

/**
 * Validate and re-price multiple products from the catalog.
 * Returns an array of validated items with current prices,
 * or throws if any product is unavailable.
 */
async function validateAndPriceItems(cartItems) {
    const validatedItems = [];

    for (const item of cartItems) {
        const product = await getProduct(item.productId);

        if (!product) {
            throw new Error(`Product ${item.productId} is no longer available`);
        }

        if (!product.isActive) {
            throw new Error(`Product "${product.name}" has been discontinued`);
        }

        validatedItems.push({
            productId: item.productId,
            productName: product.name,
            productImage: product.images && product.images.length > 0
                ? product.images[0]
                : null,
            quantity: item.quantity,
            unitPrice: parseFloat(product.price),
            totalPrice: parseFloat((product.price * item.quantity).toFixed(2)),
        });
    }

    return validatedItems;
}

module.exports = { getProduct, validateAndPriceItems };
