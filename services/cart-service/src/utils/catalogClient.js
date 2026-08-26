/**
 * Catalog Client — Cart Service
 *
 * HTTP client for cross-service product validation. When a customer adds
 * an item to their cart, we validate that the product exists and is active
 * by calling the Catalog Service via REST.
 *
 * Why REST and not shared DB access?
 *   - Database-per-service pattern: the cart service has no access to MongoDB
 *   - The catalog service OWNS product data — we ask it, not its database
 *   - REST is appropriate here because the user is waiting (Technical_Specification.md §3)
 *
 * Why snapshot the product data in the cart?
 *   - If a product price changes after the user adds it to cart, the cart
 *     should show the price at time of adding (or the latest — design choice)
 *   - We store name/price/image at add-time for display; the order service
 *     will re-validate at checkout for correctness
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
                service: 'cart-service',
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
            service: 'cart-service',
            message: 'Failed to fetch product from catalog service',
            productId,
            error: err.message,
        }));
        return null;
    }
}

module.exports = { getProduct };
